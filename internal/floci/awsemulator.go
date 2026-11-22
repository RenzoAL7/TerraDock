package floci

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Emulator identifiers accepted by the runner.
const (
	EmulatorFloci = "floci"
	EmulatorAWS   = "aws"

	DefaultAWSEndpoint = "https://127.0.0.1:9297"
	awsImage           = "terradock/aws-emulator:lts"
	awsContainer       = "terradock-aws-emulator"
	awsHealthTimeout   = 90 * time.Second
)

// awsDockerfile builds the official AWS Emulator (github.com/aws/aws-emulator)
// from its LTS package; AWS does not publish a container image.
//
//go:embed aws-emulator.Dockerfile
var awsDockerfile string

// EmulatorInfo describes one selectable emulator for the interface.
type EmulatorInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Endpoint     string `json:"endpoint"`
	Experimental bool   `json:"experimental"`
	CanStart     bool   `json:"canStart"`
}

func emulatorName(id string) string {
	if id == EmulatorAWS {
		return "AWS Emulator"
	}
	return "Floci"
}

// ValidateAWSEndpoint accepts only an https URL on a loopback address with an
// explicit port: the emulator writes its CA certificate per port.
func ValidateAWSEndpoint(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Port() == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" {
		return "", errors.New("el endpoint de AWS Emulator debe ser una URL https con puerto y sin ruta")
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if !strings.EqualFold(host, "localhost") && !(ip != nil && ip.IsLoopback()) {
		return "", errors.New("el endpoint de AWS Emulator debe ser local (127.0.0.1 o localhost)")
	}
	return "https://" + u.Host, nil
}

func (r *Runner) awsPort() string {
	u, _ := url.Parse(r.cfg.AWSEndpoint)
	return u.Port()
}

// awsHome is mounted as the emulator's ~/.aws/emulator; the emulator writes
// its CA certificate there on every start and removes it on a clean stop.
func (r *Runner) awsHome() string { return filepath.Join(r.cfg.StateDir, "aws-emulator") }

func (r *Runner) awsCA() string { return filepath.Join(r.awsHome(), r.awsPort(), "ca.pem") }

// awsInstance identifies the running emulator process. The CA certificate is
// regenerated on every start, and the emulator keeps resources only in memory,
// so a new certificate means every earlier resource is gone.
func (r *Runner) awsInstance() string {
	data, err := os.ReadFile(r.awsCA())
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}

// awsReachable checks /__admin/health trusting only the emulator's own CA.
func (r *Runner) awsReachable(ctx context.Context) bool {
	data, err := os.ReadFile(r.awsCA())
	if err != nil {
		return false
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(data) {
		return false
	}
	client := &http.Client{Timeout: 1500 * time.Millisecond, Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		Proxy:           nil,
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.cfg.AWSEndpoint+"/__admin/health", nil)
	if err != nil {
		return false
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// startAWS builds the image when missing, replaces TerraDock's container and
// waits until the emulator answers. The port is published on 127.0.0.1 only,
// telemetry is off and request signing is off: TerraDock uses test keys.
func (r *Runner) startAWS(ctx context.Context, job *Job) error {
	env := r.toolEnvironment()
	docker := r.cfg.Docker
	quiet := func(args ...string) error {
		cmd := exec.CommandContext(ctx, docker, args...)
		cmd.Env = env
		return cmd.Run()
	}
	if quiet("image", "inspect", awsImage) != nil {
		r.logf(job, "Construyendo la imagen %s desde el paquete LTS oficial (descarga ~200 MB, solo la primera vez)…", awsImage)
		r.logf(job, "$ docker build -t %s -", awsImage)
		if err := r.command(ctx, job, "", docker, env, strings.NewReader(awsDockerfile), "build", "-t", awsImage, "-"); err != nil {
			return err
		}
	}
	_ = quiet("rm", "-f", awsContainer)
	home := r.awsHome()
	if err := os.MkdirAll(home, 0o700); err != nil {
		return errors.New("no se pudo preparar la carpeta del emulador")
	}
	_ = os.Remove(r.awsCA()) // a stale certificate must not look like a running emulator
	port := r.awsPort()
	args := []string{"run", "-d", "--rm", "--name", awsContainer, "--memory=2g", "--memory-swap=2g",
		"-p", fmt.Sprintf("127.0.0.1:%s:%s", port, port),
		"-e", "EMULATOR_TELEMETRY=off",
		"-v", home + ":/home/emulator/.aws/emulator"}
	if runtime.GOOS == "linux" {
		args = append(args, "--user", fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid()))
	}
	args = append(args, awsImage, "-p", port, "--auth", "off")
	r.logf(job, "$ docker %s", strings.Join(args, " "))
	if err := r.command(ctx, job, "", docker, env, nil, args...); err != nil {
		return err
	}
	deadline := time.Now().Add(awsHealthTimeout)
	for !r.awsReachable(ctx) {
		if time.Now().After(deadline) {
			return errors.New("AWS Emulator no respondió a tiempo; revisa `docker logs " + awsContainer + "`")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	r.logf(job, "AWS Emulator listo en %s", r.cfg.AWSEndpoint)
	return nil
}

// resetIfRestarted drops the Terraform state of a staging copy when it was
// written against an emulator process that no longer exists.
func (r *Runner) resetIfRestarted(job *Job, dir, instance string) error {
	marker := filepath.Join(dir, ".terradock-emulator-instance")
	previous, _ := os.ReadFile(marker)
	if len(previous) > 0 && string(previous) != instance {
		removed := false
		for _, name := range []string{"terraform.tfstate", "terraform.tfstate.backup", "terradock.tfplan"} {
			if os.Remove(filepath.Join(dir, name)) == nil {
				removed = true
			}
		}
		if removed {
			r.logf(job, "AWS Emulator se reinició y no conserva recursos: se descartó el estado anterior.")
		}
	}
	return os.WriteFile(marker, []byte(instance), 0o600)
}
