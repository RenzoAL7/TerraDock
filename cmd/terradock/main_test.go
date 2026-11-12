package main

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/RenzoAL7/TerraDock/internal/workspace"
)

const source = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`

func tempRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func newManager(t *testing.T, root string) *workspace.Manager {
	t.Helper()
	manager, err := workspace.New(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(manager.Close)
	return manager
}

func TestStartupOpensRootWithTerraform(t *testing.T) {
	root := tempRoot(t)
	if err := os.WriteFile(filepath.Join(root, "main.tf"), []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	manager := newManager(t, root)
	snapshot, err := openInitial(manager, "")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Mode != "local" || snapshot.Path != root || len(snapshot.Resources) != 1 || snapshot.Resources[0].ID != "aws_vpc.main" {
		t.Fatalf("startup did not open the root project: %+v", snapshot)
	}
	if current := manager.Snapshot(); current.ID != snapshot.ID {
		t.Fatalf("manager serves %s, want %s", current.ID, snapshot.ID)
	}
}

func TestStartupKeepsExampleWithoutTerraform(t *testing.T) {
	root := tempRoot(t)
	if err := os.Mkdir(filepath.Join(root, "infra"), 0700); err != nil {
		t.Fatal(err)
	}
	snapshot, err := openInitial(newManager(t, root), "")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Mode != "demo" {
		t.Fatalf("an empty root must keep the example, got %s", snapshot.Mode)
	}
}

func TestStartupOpensExplicitPathAndRejectsEmptyOne(t *testing.T) {
	root := tempRoot(t)
	project := filepath.Join(root, "infra")
	empty := filepath.Join(root, "empty")
	for _, dir := range []string{project, empty} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(project, "main.tf"), []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	manager := newManager(t, root)
	snapshot, err := openInitial(manager, project)
	if err != nil || snapshot.Path != project {
		t.Fatalf("explicit path: %+v, %v", snapshot, err)
	}
	if _, err := openInitial(manager, empty); err == nil || !strings.Contains(err.Error(), ".tf") {
		t.Fatalf("a folder without .tf must fail with a clear message, got %v", err)
	}
	if _, err := openInitial(manager, filepath.Join(root, "missing")); err == nil || !strings.Contains(err.Error(), "no existe") {
		t.Fatalf("a missing folder must fail, got %v", err)
	}
	if _, err := openInitial(manager, tempRoot(t)); err == nil {
		t.Fatal("a folder outside --root must be rejected")
	}
}

func TestParseArgsAcceptsPositionalPath(t *testing.T) {
	c, err := parseArgs([]string{"./infra", "--port", "8080"})
	if err != nil {
		t.Fatal(err)
	}
	if c.openPath != "./infra" || c.root != "./infra" || c.port != 8080 {
		t.Fatalf("unexpected config: %+v", c)
	}
	c, err = parseArgs([]string{"--root", "/srv", "--open-path", "/srv/app"})
	if err != nil || c.root != "/srv" || c.openPath != "/srv/app" {
		t.Fatalf("explicit root must be kept: %+v, %v", c, err)
	}
	for _, args := range [][]string{{"a", "b"}, {"--open-path", "a", "b"}, {"--port", "0"}} {
		if _, err := parseArgs(args); err == nil {
			t.Fatalf("%v must be rejected", args)
		}
	}
}

func TestListenExplainsBusyPort(t *testing.T) {
	busy, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	port := busy.Addr().(*net.TCPAddr).Port
	listener, err := listen(port)
	if err == nil {
		listener.Close()
		t.Fatal("a busy port must fail")
	}
	if !strings.Contains(err.Error(), "ya está en uso") || !strings.Contains(err.Error(), "--port") {
		t.Fatalf("message must explain the busy port and suggest --port: %v", err)
	}
	free, err := listen(0)
	if err != nil {
		t.Fatal(err)
	}
	free.Close()
}
