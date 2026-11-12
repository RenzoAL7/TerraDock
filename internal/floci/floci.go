// Package floci runs Terraform against a local Floci AWS emulator.
//
// Every run works on a private staging copy of the confirmed (saved) project
// files. The user's folder is never modified: provider endpoints, credentials
// and the state backend are redirected through override files that only exist
// in the staging copy. Real AWS credentials from the environment are removed.
package floci

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	DefaultEndpoint = "http://localhost:4566"
	maxLogLines     = 2000
	jobTimeout      = 20 * time.Minute
	overrideFile    = "terradock_floci_override.tf"
	providerFile    = "terradock_floci_provider.tf"
)

// Services redirected to Floci. Names are AWS provider `endpoints` arguments.
var services = []string{
	"acm", "apigateway", "apigatewayv2", "autoscaling", "cloudformation", "cloudwatch",
	"dynamodb", "ec2", "ecr", "ecs", "elasticache", "elb", "elbv2", "events", "firehose",
	"iam", "kinesis", "kms", "lambda", "logs", "rds", "route53", "s3", "secretsmanager",
	"ses", "sns", "sqs", "ssm", "stepfunctions", "sts",
}

// Project is the confirmed state of the open project. Dir is empty for
// in-memory examples; for local folders it is used to read *.tfvars files.
type Project struct {
	ID    string
	Name  string
	Dir   string
	Files map[string]string
}

// Source returns the saved files of the open project and its identity.
type Source func() Project

type Config struct {
	Endpoint  string // Floci endpoint; loopback or *.floci.io only.
	Terraform string // Terraform/OpenTofu binary; looked up in PATH when empty.
	Floci     string // Floci CLI; optional, used only to start the emulator.
	StateDir  string // Private directory for staging copies and state.
}

// Change is the planned action for one graph resource ID.
type Change struct {
	Address string   `json:"address"`
	Actions []string `json:"actions"`
}

type Plan struct {
	ProjectID   string            `json:"projectId"`
	Fingerprint string            `json:"-"`
	Changes     map[string]string `json:"changes"` // resource ID → create|update|delete|replace|read
	Counts      map[string]int    `json:"counts"`
	CreatedAt   time.Time         `json:"createdAt"`
	Stale       bool              `json:"stale"`
}

type Job struct {
	ID        string    `json:"id"`
	Action    string    `json:"action"`
	ProjectID string    `json:"projectId"`
	State     string    `json:"state"` // running|succeeded|failed|canceled
	Error     string    `json:"error,omitempty"`
	Log       []string  `json:"log"`
	Started   time.Time `json:"started"`
	Finished  time.Time `json:"finished,omitzero"`
}

// Variable is a root input variable. Values are never echoed back.
type Variable struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required"` // no default in the configuration
	Provided    bool   `json:"provided"` // set by a tfvars file or in TerraDock
}

type Status struct {
	Endpoint         string     `json:"endpoint"`
	Reachable        bool       `json:"reachable"`
	Terraform        string     `json:"terraform"`
	TerraformVersion string     `json:"terraformVersion"`
	CanStart         bool       `json:"canStart"`
	Job              *Job       `json:"job,omitempty"`
	Plan             *Plan      `json:"plan,omitempty"`
	Deployed         []string   `json:"deployed"`
	Variables        []Variable `json:"variables"`
}

type Runner struct {
	cfg      Config
	source   Source
	client   *http.Client
	mu       sync.Mutex
	job      *Job
	cancel   context.CancelFunc
	plans    map[string]*Plan
	deployed map[string][]string
	values   map[string]map[string]string // project → variable values (memory only)
	version  string
	seq      int
}

var hostPattern = regexp.MustCompile(`(?i)^[a-z0-9-]+\.floci\.io$`)

// ValidateEndpoint keeps the integration local: only loopback hosts or the
// Floci wildcard domain (which resolves to 127.0.0.1) are accepted.
func ValidateEndpoint(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" {
		return "", errors.New("el endpoint de Floci debe ser una URL http(s) sin ruta")
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if !strings.EqualFold(host, "localhost") && !(ip != nil && ip.IsLoopback()) && !hostPattern.MatchString(host) {
		return "", errors.New("el endpoint de Floci debe ser local (localhost, 127.0.0.1 o *.floci.io)")
	}
	return u.Scheme + "://" + u.Host, nil
}

func New(cfg Config, source Source) (*Runner, error) {
	if cfg.Endpoint == "" {
		cfg.Endpoint = DefaultEndpoint
	}
	endpoint, err := ValidateEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	cfg.Endpoint = endpoint
	if cfg.Terraform == "" {
		for _, name := range []string{"terraform", "tofu"} {
			if path, err := exec.LookPath(name); err == nil {
				cfg.Terraform = path
				break
			}
		}
	}
	if cfg.Floci == "" {
		if path, err := exec.LookPath("floci"); err == nil {
			cfg.Floci = path
		}
	}
	if cfg.StateDir == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			base = os.TempDir()
		}
		cfg.StateDir = filepath.Join(base, "terradock", "floci")
	}
	if err := os.MkdirAll(cfg.StateDir, 0o700); err != nil {
		return nil, fmt.Errorf("prepare floci state dir: %w", err)
	}
	return &Runner{cfg: cfg, source: source, client: &http.Client{Timeout: 1500 * time.Millisecond}, plans: map[string]*Plan{}, deployed: map[string][]string{}, values: map[string]map[string]string{}}, nil
}

func (r *Runner) Close() {
	r.mu.Lock()
	if r.cancel != nil {
		r.cancel()
	}
	r.mu.Unlock()
}

// Status reports emulator reachability, the current job and, for the open
// project, the last plan (marked stale when saved files changed) and the
// resources present in the Floci state.
func (r *Runner) Status(ctx context.Context) Status {
	status := Status{Endpoint: r.cfg.Endpoint, Terraform: r.cfg.Terraform, CanStart: r.cfg.Floci != "", Deployed: []string{}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.cfg.Endpoint+"/", nil)
	if err == nil {
		if resp, err := r.client.Do(req); err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			resp.Body.Close()
			status.Reachable = true
		}
	}
	project := r.source()
	projectID, files := project.ID, project.Files
	variables := Variables(files, ReadTFVars(project.Dir))
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range variables {
		if _, ok := r.values[projectID][variables[i].Name]; ok {
			variables[i].Provided = true
		}
	}
	status.Variables = variables
	if r.version == "" && r.cfg.Terraform != "" {
		r.version = terraformVersion(r.cfg.Terraform)
	}
	status.TerraformVersion = r.version
	if r.job != nil {
		job := *r.job
		job.Log = append([]string(nil), r.job.Log...)
		status.Job = &job
	}
	if plan := r.plans[projectID]; plan != nil {
		copy := *plan
		copy.Stale = plan.Fingerprint != fingerprint(files)
		status.Plan = &copy
	}
	if deployed := r.deployed[projectID]; deployed != nil {
		status.Deployed = append(status.Deployed, deployed...)
	}
	return status
}

func terraformVersion(binary string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, binary, "version", "-json").Output()
	if err != nil {
		return ""
	}
	var parsed struct {
		Version string `json:"terraform_version"`
	}
	if json.Unmarshal(out, &parsed) != nil {
		return ""
	}
	return parsed.Version
}

var ErrBusy = errors.New("ya hay una operación de Floci en curso")

// Start launches an action in the background. Actions: start, plan, apply,
// destroy, refresh. Apply only executes the saved plan for unchanged files.
// Values set input variables for this and later runs of the project.
func (r *Runner) Start(action, projectID string, values map[string]string) (*Job, error) {
	switch action {
	case "start", "plan", "apply", "destroy", "refresh":
	default:
		return nil, errors.New("acción de Floci no válida")
	}
	project := r.source()
	current, files := project.ID, project.Files
	if projectID == "" || projectID != current {
		return nil, errors.New("el proyecto abierto cambió; recarga antes de continuar")
	}
	if action == "start" && r.cfg.Floci == "" {
		return nil, errors.New("no se encontró la CLI de Floci en el PATH")
	}
	if action != "start" && r.cfg.Terraform == "" {
		return nil, errors.New("no se encontró Terraform ni OpenTofu en el PATH")
	}
	if action != "start" && len(files) == 0 {
		return nil, errors.New("el proyecto no tiene archivos .tf")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.job != nil && r.job.State == "running" {
		return nil, ErrBusy
	}
	if len(values) > 0 {
		known := map[string]bool{}
		for _, v := range Variables(files, nil) {
			known[v.Name] = true
		}
		stored := map[string]string{}
		for name, value := range r.values[projectID] {
			stored[name] = value
		}
		for name, value := range values {
			if !known[name] {
				return nil, fmt.Errorf("la variable %q no está declarada", name)
			}
			if value == "" {
				delete(stored, name)
			} else {
				stored[name] = value
			}
		}
		r.values[projectID] = stored
	}
	vars := map[string]string{}
	for name, value := range r.values[projectID] {
		vars[name] = value
	}
	if action == "apply" {
		plan := r.plans[projectID]
		if plan == nil {
			return nil, errors.New("genera un plan antes de aplicar")
		}
		if plan.Fingerprint != fingerprint(files) {
			return nil, errors.New("los archivos cambiaron desde el plan; genera uno nuevo")
		}
	}
	r.seq++
	job := &Job{ID: fmt.Sprintf("job-%d", r.seq), Action: action, ProjectID: projectID, State: "running", Log: []string{}, Started: time.Now()}
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	r.job, r.cancel = job, cancel
	go r.run(ctx, cancel, job, project, vars)
	copy := *job
	return &copy, nil
}

func (r *Runner) Cancel() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.job == nil || r.job.State != "running" || r.cancel == nil {
		return false
	}
	r.cancel()
	return true
}

func (r *Runner) logf(job *Job, format string, args ...any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job.Log = append(job.Log, fmt.Sprintf(format, args...))
	if len(job.Log) > maxLogLines {
		job.Log = job.Log[len(job.Log)-maxLogLines:]
	}
}

func (r *Runner) run(ctx context.Context, cancel context.CancelFunc, job *Job, project Project, vars map[string]string) {
	defer cancel()
	err := r.execute(ctx, job, project, vars)
	r.mu.Lock()
	defer r.mu.Unlock()
	job.Finished = time.Now()
	switch {
	case err == nil:
		job.State = "succeeded"
	case errors.Is(ctx.Err(), context.Canceled):
		job.State, job.Error = "canceled", "Operación cancelada."
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		job.State, job.Error = "failed", "La operación superó el tiempo máximo."
	default:
		job.State, job.Error = "failed", err.Error()
	}
}

func (r *Runner) execute(ctx context.Context, job *Job, project Project, vars map[string]string) error {
	name, files := project.Name, project.Files
	if job.Action == "start" {
		r.logf(job, "$ floci start")
		return r.command(ctx, job, "", r.cfg.Floci, nil, "start")
	}
	dir := filepath.Join(r.cfg.StateDir, safeName(job.ProjectID))
	layout, err := Stage(dir, files, r.cfg.Endpoint, ReadTFVars(project.Dir), vars)
	if err != nil {
		return err
	}
	r.logf(job, "Copia de trabajo: %s", dir)
	r.logf(job, "Endpoint Floci: %s · proyecto %s", r.cfg.Endpoint, name)
	if layout.GeneratedProvider {
		r.logf(job, "El proyecto no declara provider \"aws\"; se usa uno temporal para Floci.")
	}
	env := r.environment(dir)
	tf := func(args ...string) error {
		r.logf(job, "$ terraform %s", strings.Join(args, " "))
		return r.command(ctx, job, dir, r.cfg.Terraform, env, args...)
	}
	if err := tf("init", "-input=false", "-no-color", "-reconfigure"); err != nil {
		return err
	}
	switch job.Action {
	case "plan":
		if err := tf("plan", "-input=false", "-no-color", "-out=terradock.tfplan"); err != nil {
			return err
		}
		plan, err := r.readPlan(ctx, dir, env)
		if err != nil {
			return err
		}
		plan.ProjectID, plan.Fingerprint, plan.CreatedAt = job.ProjectID, fingerprint(files), time.Now()
		r.mu.Lock()
		r.plans[job.ProjectID] = plan
		r.mu.Unlock()
		r.logf(job, "Plan: %d crear · %d actualizar · %d reemplazar · %d eliminar", plan.Counts["create"], plan.Counts["update"], plan.Counts["replace"], plan.Counts["delete"])
	case "apply":
		err := tf("apply", "-input=false", "-no-color", "terradock.tfplan")
		r.mu.Lock()
		delete(r.plans, job.ProjectID) // a plan file can only be applied once
		r.mu.Unlock()
		if err != nil {
			_ = r.readState(ctx, job.ProjectID, dir, env)
			return err
		}
	case "destroy":
		// No refresh: an emulator gap in one resource must not block cleaning up the rest.
		err := tf("destroy", "-input=false", "-no-color", "-auto-approve", "-refresh=false")
		r.mu.Lock()
		delete(r.plans, job.ProjectID)
		r.mu.Unlock()
		if err != nil {
			_ = r.readState(ctx, job.ProjectID, dir, env)
			return err
		}
	}
	return r.readState(ctx, job.ProjectID, dir, env)
}

func (r *Runner) environment(dir string) []string {
	env := make([]string, 0, len(os.Environ())+12)
	for _, kv := range os.Environ() {
		key, _, _ := strings.Cut(kv, "=")
		upper := strings.ToUpper(key)
		// Never let real credentials, profiles or endpoints reach the run.
		if strings.HasPrefix(upper, "AWS_") || strings.HasPrefix(upper, "TF_") {
			continue
		}
		env = append(env, kv)
	}
	missing := filepath.Join(dir, ".no-aws-config")
	return append(env,
		"AWS_ACCESS_KEY_ID=test", "AWS_SECRET_ACCESS_KEY=test", "AWS_REGION=us-east-1", "AWS_DEFAULT_REGION=us-east-1",
		"AWS_ENDPOINT_URL="+r.cfg.Endpoint, "AWS_CONFIG_FILE="+missing, "AWS_SHARED_CREDENTIALS_FILE="+missing,
		"AWS_EC2_METADATA_DISABLED=true",
		"TF_IN_AUTOMATION=1", "TF_INPUT=0", "CHECKPOINT_DISABLE=1",
		"TF_PLUGIN_CACHE_DIR="+filepath.Join(r.cfg.StateDir, "plugin-cache"),
	)
}

func (r *Runner) command(ctx context.Context, job *Job, dir, binary string, env []string, args ...string) error {
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = dir
	if env != nil {
		cmd.Env = env
	}
	cmd.WaitDelay = 5 * time.Second
	reader, writer := io.Pipe()
	cmd.Stdout, cmd.Stderr = writer, writer
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("no se pudo ejecutar %s: %w", filepath.Base(binary), err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			r.logf(job, "%s", scanner.Text())
		}
		_, _ = io.Copy(io.Discard, reader)
	}()
	err := cmd.Wait()
	writer.Close()
	<-done
	if err != nil {
		return fmt.Errorf("%s %s terminó con error", filepath.Base(binary), args[0])
	}
	return nil
}

func (r *Runner) output(ctx context.Context, dir string, env []string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, r.cfg.Terraform, args...)
	cmd.Dir, cmd.Env = dir, env
	return cmd.Output()
}

func (r *Runner) readPlan(ctx context.Context, dir string, env []string) (*Plan, error) {
	out, err := r.output(ctx, dir, env, "show", "-json", "terradock.tfplan")
	if err != nil {
		return nil, errors.New("no se pudo leer el plan generado")
	}
	return ParsePlan(out)
}

func (r *Runner) readState(ctx context.Context, projectID, dir string, env []string) error {
	ids := []string{}
	if _, err := os.Stat(filepath.Join(dir, "terraform.tfstate")); err == nil {
		out, err := r.output(ctx, dir, env, "show", "-json")
		if err != nil {
			return errors.New("no se pudo leer el estado de Floci")
		}
		ids, err = ParseState(out)
		if err != nil {
			return err
		}
	}
	r.mu.Lock()
	r.deployed[projectID] = ids
	r.mu.Unlock()
	return nil
}

// ResourceID maps a root-module Terraform address to the diagram resource ID:
// aws_instance.web[0] and aws_instance.web["a"] both map to aws_instance.web.
// Addresses inside modules and data sources are ignored.
func ResourceID(address string) string {
	if strings.HasPrefix(address, "module.") || strings.HasPrefix(address, "data.") {
		return ""
	}
	if i := strings.IndexByte(address, '['); i >= 0 {
		address = address[:i]
	}
	return address
}

func ParsePlan(data []byte) (*Plan, error) {
	var parsed struct {
		ResourceChanges []struct {
			Address string `json:"address"`
			Mode    string `json:"mode"`
			Change  struct {
				Actions []string `json:"actions"`
			} `json:"change"`
		} `json:"resource_changes"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, errors.New("el plan JSON no es válido")
	}
	plan := &Plan{Changes: map[string]string{}, Counts: map[string]int{}}
	rank := map[string]int{"": 0, "read": 1, "update": 2, "create": 3, "delete": 4, "replace": 5}
	for _, change := range parsed.ResourceChanges {
		if change.Mode == "data" {
			continue
		}
		action := summarize(change.Change.Actions)
		if action == "" {
			continue
		}
		plan.Counts[action]++
		if id := ResourceID(change.Address); id != "" && rank[action] > rank[plan.Changes[id]] {
			plan.Changes[id] = action
		}
	}
	return plan, nil
}

func summarize(actions []string) string {
	joined := strings.Join(actions, ",")
	switch joined {
	case "create":
		return "create"
	case "update":
		return "update"
	case "delete":
		return "delete"
	case "delete,create", "create,delete":
		return "replace"
	default:
		return ""
	}
}

func ParseState(data []byte) ([]string, error) {
	var parsed struct {
		Values *struct {
			RootModule struct {
				Resources []struct {
					Address string `json:"address"`
					Mode    string `json:"mode"`
				} `json:"resources"`
			} `json:"root_module"`
		} `json:"values"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, errors.New("el estado JSON no es válido")
	}
	seen := map[string]bool{}
	ids := []string{}
	if parsed.Values == nil {
		return ids, nil
	}
	for _, res := range parsed.Values.RootModule.Resources {
		if res.Mode != "managed" {
			continue
		}
		if id := ResourceID(res.Address); id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids, nil
}

func fingerprint(files map[string]string) string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	h := sha256.New()
	for _, name := range names {
		fmt.Fprintf(h, "%d:%s:%d:%s;", len(name), name, len(files[name]), files[name])
	}
	return hex.EncodeToString(h.Sum(nil))
}

func safeName(id string) string {
	sum := sha256.Sum256([]byte(id))
	clean := regexp.MustCompile(`[^a-zA-Z0-9_-]+`).ReplaceAllString(id, "-")
	if len(clean) > 40 {
		clean = clean[:40]
	}
	return clean + "-" + hex.EncodeToString(sum[:4])
}
