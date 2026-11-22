package floci

import (
	"context"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/RenzoAL7/TerraDock/internal/floci/flocitest"
)

func TestValidateAWSEndpoint(t *testing.T) {
	for _, ok := range []string{"https://127.0.0.1:9297", "https://localhost:9297/", "https://[::1]:9300"} {
		if _, err := ValidateAWSEndpoint(ok); err != nil {
			t.Errorf("%s rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{"http://127.0.0.1:9297", "https://127.0.0.1", "https://ec2.us-east-1.amazonaws.com:443", "https://localhost.floci.io:9297", "https://127.0.0.1:9297/x", "https://u@127.0.0.1:9297"} {
		if _, err := ValidateAWSEndpoint(bad); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
}

func TestOverridesTrustTheEmulatorCA(t *testing.T) {
	override, _ := Overrides(Layout{Aliases: []string{""}}, "https://127.0.0.1:9297", "/state/aws-emulator/9297/ca.pem")
	for _, want := range []string{`custom_ca_bundle            = "/state/aws-emulator/9297/ca.pem"`, `ec2 = "https://127.0.0.1:9297"`} {
		if !strings.Contains(override, want) {
			t.Errorf("override missing %q:\n%s", want, override)
		}
	}
	if floci, _ := Overrides(Layout{Aliases: []string{""}}, "http://localhost:4566", ""); strings.Contains(floci, "custom_ca_bundle") {
		t.Error("Floci override must not set a CA bundle")
	}
}

func TestSetEmulator(t *testing.T) {
	r, err := New(Config{StateDir: t.TempDir(), Terraform: "/bin/true"}, func() Project { return Project{ID: "p1"} })
	if err != nil {
		t.Fatal(err)
	}
	if r.Emulator() != EmulatorFloci {
		t.Fatalf("default emulator = %q", r.Emulator())
	}
	if err := r.SetEmulator("localstack"); err == nil {
		t.Fatal("unknown emulator accepted")
	}
	if err := r.SetEmulator(EmulatorAWS); err != nil {
		t.Fatal(err)
	}
	status := r.Status(context.Background())
	if status.Emulator != EmulatorAWS || status.Endpoint != DefaultAWSEndpoint || status.Reachable || len(status.Emulators) != 2 {
		t.Fatalf("status = %+v", status)
	}
	if _, err := New(Config{StateDir: t.TempDir(), Emulator: "other"}, func() Project { return Project{} }); err == nil {
		t.Fatal("invalid initial emulator accepted")
	}
}

func TestAWSRunsWithoutEmulatorFailBeforeTerraform(t *testing.T) {
	log := filepath.Join(t.TempDir(), "terraform.log")
	tf := flocitest.FakeTool(t, "terraform", log, "", "", 0)
	r, err := New(Config{StateDir: t.TempDir(), Terraform: tf, Emulator: EmulatorAWS}, func() Project {
		return Project{ID: "p1", Files: map[string]string{"main.tf": `resource "aws_s3_bucket" "b" {}`}}
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Start("plan", "p1", nil); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "plan", func() bool { job := r.Status(context.Background()).Job; return job != nil && job.State != "running" })
	if job := r.Status(context.Background()).Job; job.State != "failed" || !strings.Contains(job.Error, "no está en marcha") {
		t.Fatalf("job = %+v", job)
	}
	for _, line := range strings.Split(flocitest.ReadLog(log), "\n") {
		if strings.HasPrefix(line, "args: init") {
			t.Fatal("terraform ran without an emulator")
		}
	}
}

func TestAWSEnvironmentTrustsOnlyTheEmulator(t *testing.T) {
	setRealAWSEnvironment(t)
	r, err := New(Config{StateDir: t.TempDir(), Terraform: "/bin/true"}, func() Project { return Project{ID: "p1"} })
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]string{}
	for _, kv := range r.environment(t.TempDir(), EmulatorAWS, "/ca.pem") {
		key, value, _ := strings.Cut(kv, "=")
		values[key] = value
	}
	for key, want := range map[string]string{"AWS_ENDPOINT_URL": DefaultAWSEndpoint, "AWS_CA_BUNDLE": "/ca.pem", "AWS_ACCESS_KEY_ID": "test", "AWS_DISABLE_HOST_PREFIX_INJECTION": "true"} {
		if values[key] != want {
			t.Errorf("%s = %q, want %q", key, values[key], want)
		}
	}
	if _, ok := values["AWS_PROFILE"]; ok {
		t.Error("AWS_PROFILE reached terraform")
	}
}

// The emulator keeps resources in memory only: after a restart (new CA), the
// state read from the earlier process is not reported and is discarded.
func TestAWSRestartDropsEarlierState(t *testing.T) {
	r, err := New(Config{StateDir: t.TempDir(), Terraform: "/bin/true", Emulator: EmulatorAWS}, func() Project { return Project{ID: "p1"} })
	if err != nil {
		t.Fatal(err)
	}
	writeCA := func(body string) {
		if err := os.MkdirAll(filepath.Dir(r.awsCA()), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(r.awsCA(), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeCA("first")
	key := stateKey(EmulatorAWS, "p1")
	r.deployed[key], r.instances[key] = []string{"aws_s3_bucket.b"}, r.awsInstance()
	if got := r.Status(context.Background()).Deployed; len(got) != 1 {
		t.Fatalf("deployed = %v", got)
	}
	writeCA("second")
	if got := r.Status(context.Background()).Deployed; len(got) != 0 {
		t.Fatalf("resources of a stopped emulator reported: %v", got)
	}

	dir := t.TempDir()
	job := &Job{}
	if err := r.resetIfRestarted(job, dir, "a"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "terraform.tfstate"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := r.resetIfRestarted(job, dir, "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "terraform.tfstate")); err != nil {
		t.Fatal("state removed for the same emulator process")
	}
	if err := r.resetIfRestarted(job, dir, "b"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "terraform.tfstate")); !os.IsNotExist(err) {
		t.Fatal("state of a restarted emulator was kept")
	}
}

// Start builds the image when missing, runs the container bound to
// 127.0.0.1 with telemetry and request signing off, and waits for health.
func TestAWSStartBuildsAndRunsContainer(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake docker is a shell script")
	}
	setRealAWSEnvironment(t)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/__admin/health" {
			http.NotFound(w, req)
			return
		}
		fmt.Fprint(w, "ok")
	}))
	t.Cleanup(server.Close)
	tmp := t.TempDir()
	certFile := filepath.Join(tmp, "server.pem")
	if err := os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	port := strings.TrimPrefix(server.URL, "https://127.0.0.1:")
	state := t.TempDir()
	ca := filepath.Join(state, "aws-emulator", port, "ca.pem")
	log, stdin := filepath.Join(tmp, "docker.log"), filepath.Join(tmp, "stdin")
	docker := filepath.Join(tmp, "docker")
	script := fmt.Sprintf(`#!/bin/sh
{ echo "args: $*"; env; echo "--"; } >> %q
case "$1" in
  image) exit 1 ;;
  build) cat > %q ;;
  run) mkdir -p %q && cp %q %q ;;
esac
exit 0
`, log, stdin, filepath.Dir(ca), certFile, ca)
	if err := os.WriteFile(docker, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(server.URL)
	r, err := New(Config{StateDir: state, Terraform: "/bin/true", Docker: docker, Emulator: EmulatorAWS, AWSEndpoint: "https://" + u.Host}, func() Project { return Project{ID: "p1"} })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Start("start", "p1", nil); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "aws start", func() bool { job := r.Status(context.Background()).Job; return job != nil && job.State != "running" })
	status := r.Status(context.Background())
	if status.Job.State != "succeeded" || !status.Reachable {
		t.Fatalf("status = %+v", status)
	}
	recorded := flocitest.ReadLog(log)
	for _, want := range []string{"args: build -t " + awsImage + " -", "-p 127.0.0.1:" + port + ":" + port, "-e EMULATOR_TELEMETRY=off", awsImage + " -p " + port + " --auth off"} {
		if !strings.Contains(recorded, want) {
			t.Errorf("docker log missing %q:\n%s", want, recorded)
		}
	}
	if body, _ := os.ReadFile(stdin); !strings.Contains(string(body), "aws-emulator") {
		t.Errorf("Dockerfile not sent on stdin: %q", body)
	}
	for _, line := range strings.Split(recorded, "\n") {
		if strings.HasPrefix(strings.ToUpper(line), "AWS_") {
			t.Fatalf("docker received %q", line)
		}
	}
}
