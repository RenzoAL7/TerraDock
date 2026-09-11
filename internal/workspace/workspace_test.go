package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const networkSource = `# preserve this comment
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16" # preserve this too
}
resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`

func localProject(t *testing.T) (*Manager, string, Snapshot) {
	t.Helper()
	root := t.TempDir()
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(root, "app")
	if err := os.Mkdir(project, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "main.tf"), []byte(networkSource), 0640); err != nil {
		t.Fatal(err)
	}
	m, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	snapshot, err := m.Open(project)
	if err != nil {
		t.Fatal(err)
	}
	return m, project, snapshot
}

func errorCode(t *testing.T, err error, code string) {
	t.Helper()
	var actual *Error
	if !errors.As(err, &actual) || actual.Code != code {
		t.Fatalf("expected %s, got %v", code, err)
	}
}

func TestSaveWritesOriginalFileAndRejectsStaleRevision(t *testing.T) {
	m, project, initial := localProject(t)
	replacement := strings.Replace(networkSource, "10.0.1.0/24", "10.0.2.0/24", 1)
	next, err := m.Save(m.Snapshot().ID, "main.tf", replacement, initial.Files[0].Revision)
	if err != nil {
		t.Fatal(err)
	}
	if !next.Valid || next.Files[0].Content != replacement {
		t.Fatal("saved content did not become the current project")
	}
	actual, err := os.ReadFile(filepath.Join(project, "main.tf"))
	if err != nil || string(actual) != replacement {
		t.Fatalf("disk content mismatch: %s, %v", actual, err)
	}
	info, err := os.Stat(filepath.Join(project, "main.tf"))
	if err != nil || info.Mode().Perm() != 0640 {
		t.Fatal("file permissions changed")
	}
	_, err = m.Save(m.Snapshot().ID, "main.tf", networkSource, initial.Files[0].Revision)
	errorCode(t, err, "revision_conflict")
	actual, _ = os.ReadFile(filepath.Join(project, "main.tf"))
	if string(actual) != replacement {
		t.Fatal("stale save overwrote disk")
	}
	leftovers, _ := filepath.Glob(filepath.Join(project, ".terradock-save-*"))
	if len(leftovers) != 0 {
		t.Fatalf("temporary files left behind: %v", leftovers)
	}
}

func TestSaveDetectsExternalWriteBeforeWatcherRuns(t *testing.T) {
	m, project, initial := localProject(t)
	external := strings.Replace(networkSource, "10.0.1.0/24", "10.0.3.0/24", 1)
	if err := os.WriteFile(filepath.Join(project, "main.tf"), []byte(external), 0640); err != nil {
		t.Fatal(err)
	}
	_, err := m.Save(m.Snapshot().ID, "main.tf", "# my draft", initial.Files[0].Revision)
	errorCode(t, err, "revision_conflict")
	actual, _ := os.ReadFile(filepath.Join(project, "main.tf"))
	if string(actual) != external {
		t.Fatal("external edit was overwritten")
	}
	if m.Snapshot().Files[0].Content != external {
		t.Fatal("current snapshot does not reflect external write")
	}
}

func TestPropertyPreservesUnrelatedBytesAndRejectsExpressions(t *testing.T) {
	m, _, initial := localProject(t)
	next, err := m.Property(m.Snapshot().ID, "aws_subnet.public", "cidr_block", "10.0.2.0/24", initial.Files[0].Revision)
	if err != nil {
		t.Fatal(err)
	}
	if next.Files[0].Content != strings.Replace(networkSource, "10.0.1.0/24", "10.0.2.0/24", 1) {
		t.Fatal("literal edit modified unrelated bytes")
	}
	_, err = m.Property(m.Snapshot().ID, "aws_subnet.public", "vpc_id", "replacement", next.Files[0].Revision)
	errorCode(t, err, "invalid_property")
}

func waitSnapshot(t *testing.T, events <-chan Snapshot, accept func(Snapshot) bool) Snapshot {
	t.Helper()
	deadline := time.NewTimer(4 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case snapshot := <-events:
			if accept(snapshot) {
				return snapshot
			}
		case <-deadline.C:
			t.Fatal("watcher did not publish expected project state")
		}
	}
}

func TestWatcherPreservesLastValidGraphAndRecovers(t *testing.T) {
	m, project, initial := localProject(t)
	events, cancel := m.Subscribe()
	defer cancel()
	<-events
	path := filepath.Join(project, "main.tf")
	if err := os.WriteFile(path, []byte(`resource "aws_vpc" "broken" {`), 0640); err != nil {
		t.Fatal(err)
	}
	invalid := waitSnapshot(t, events, func(s Snapshot) bool { return !s.Valid })
	if invalid.Sequence <= initial.Sequence {
		t.Fatal("invalid watcher snapshot did not advance sequence")
	}
	if len(invalid.Resources) != len(initial.Resources) || len(invalid.Edges) != len(initial.Edges) || len(invalid.Diagnostics) == 0 {
		t.Fatal("invalid syntax discarded the last valid graph or diagnostics")
	}
	if invalid.Files[0].Content == initial.Files[0].Content {
		t.Fatal("invalid source was not surfaced")
	}
	_, err := m.Property(m.Snapshot().ID, "aws_vpc.main", "cidr_block", "10.1.0.0/16", invalid.Files[0].Revision)
	errorCode(t, err, "invalid_property")
	if err := os.WriteFile(path, []byte(networkSource), 0640); err != nil {
		t.Fatal(err)
	}
	recovered := waitSnapshot(t, events, func(s Snapshot) bool { return s.Valid })
	if recovered.Sequence <= invalid.Sequence {
		t.Fatal("recovered watcher snapshot did not advance sequence")
	}
	if recovered.Revision == invalid.Revision || len(recovered.Resources) != 2 {
		t.Fatal("watcher did not recover the graph")
	}
}

func TestWatcherPublishesIOErrorsAndRecovers(t *testing.T) {
	m, project, initial := localProject(t)
	events, cancel := m.Subscribe()
	defer cancel()
	<-events
	moved := project + "-moved"
	if err := os.Rename(project, moved); err != nil {
		t.Fatal(err)
	}
	invalid := waitSnapshot(t, events, func(s Snapshot) bool { return !s.Valid })
	if invalid.Sequence <= initial.Sequence {
		t.Fatal("I/O error did not advance sequence")
	}
	if len(invalid.Resources) != len(initial.Resources) || !strings.HasSuffix(invalid.Revision, "io-error") {
		t.Fatal("unreadable project did not retain graph with an error")
	}
	if err := os.Rename(moved, project); err != nil {
		t.Fatal(err)
	}
	recovered := waitSnapshot(t, events, func(s Snapshot) bool { return s.Valid })
	if recovered.Sequence <= invalid.Sequence {
		t.Fatal("I/O recovery did not advance sequence")
	}
}

func TestInvalidSavePreservesGraphAndDemoNeverWritesDisk(t *testing.T) {
	m, project, _ := localProject(t)
	demo, err := m.Demo("basic-vpc")
	if err != nil {
		t.Fatal(err)
	}
	next, err := m.Save(m.Snapshot().ID, demo.Files[0].Path, `resource "broken"`, demo.Files[0].Revision)
	if err != nil {
		t.Fatal(err)
	}
	if next.Valid || len(next.Resources) != len(demo.Resources) {
		t.Fatal("invalid save did not retain last valid demo graph")
	}
	actual, _ := os.ReadFile(filepath.Join(project, "main.tf"))
	if string(actual) != networkSource {
		t.Fatal("demo changed disk")
	}
}

func TestPathsRejectEscapesSymlinksAndUnknownFiles(t *testing.T) {
	m, project, initial := localProject(t)
	outside := t.TempDir()
	_, err := m.Open(outside)
	errorCode(t, err, "forbidden_path")
	_, err = m.Directories("../")
	errorCode(t, err, "forbidden_path")
	link := filepath.Join(m.Root(), "linked")
	if err := os.Symlink(project, link); err != nil {
		t.Fatal(err)
	}
	_, err = m.Open(link)
	errorCode(t, err, "forbidden_path")
	listing, err := m.Directories("")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range listing.Entries {
		if entry.Name == "linked" {
			t.Fatal("symbolic folder appeared in directory picker")
		}
	}
	for _, name := range []string{"../main.tf", "/tmp/main.tf", `..\main.tf`, "main.txt"} {
		_, err = m.Save(m.Snapshot().ID, name, "", initial.Files[0].Revision)
		errorCode(t, err, "invalid_path")
	}
	_, err = m.Save(m.Snapshot().ID, "missing.tf", "", initial.Files[0].Revision)
	errorCode(t, err, "not_found")
	if err := os.Symlink(filepath.Join(project, "main.tf"), filepath.Join(project, "linked.tf")); err != nil {
		t.Fatal(err)
	}
	_, err = m.Open(project)
	errorCode(t, err, "forbidden_path")
}

func TestOpenOnlyReadsRootModuleAndEnforcesLimits(t *testing.T) {
	m, project, _ := localProject(t)
	child := filepath.Join(project, "child")
	if err := os.Mkdir(child, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(child, "main.tf"), []byte(`not valid hcl!`), 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := m.Open(project)
	if err != nil || !snapshot.Valid || len(snapshot.Files) != 1 {
		t.Fatal("nested module was silently merged into the root")
	}
	_, err = m.Save(m.Snapshot().ID, "main.tf", strings.Repeat("x", MaxFileBytes+1), snapshot.Files[0].Revision)
	errorCode(t, err, "too_large")
	if err := os.WriteFile(filepath.Join(project, "large.tf"), []byte(strings.Repeat("x", MaxFileBytes+1)), 0600); err != nil {
		t.Fatal(err)
	}
	_, err = m.Open(project)
	errorCode(t, err, "too_large")
}

func TestEmptyProjectDoesNotReplaceCurrentProject(t *testing.T) {
	m, project, initial := localProject(t)
	empty := filepath.Join(project, "empty")
	if err := os.Mkdir(empty, 0755); err != nil {
		t.Fatal(err)
	}
	_, err := m.Open(empty)
	errorCode(t, err, "no_terraform")
	if m.Snapshot().Revision != initial.Revision {
		t.Fatal("failed open discarded the current project")
	}
}

func TestProjectIdentityPreventsCrossProjectWrites(t *testing.T) {
	m, _, initial := localProject(t)
	other := filepath.Join(m.Root(), "other")
	if err := os.Mkdir(other, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(other, "main.tf"), []byte(networkSource), 0600); err != nil {
		t.Fatal(err)
	}
	opened, err := m.Open(other)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Files[0].Revision != initial.Files[0].Revision {
		t.Fatal("fixture must have identical file hashes")
	}
	_, err = m.Save(initial.ID, "main.tf", "# stale project draft", initial.Files[0].Revision)
	errorCode(t, err, "project_conflict")
	_, err = m.Property(initial.ID, "aws_vpc.main", "cidr_block", "10.1.0.0/16", initial.Files[0].Revision)
	errorCode(t, err, "project_conflict")
	actual, _ := os.ReadFile(filepath.Join(other, "main.tf"))
	if string(actual) != networkSource {
		t.Fatal("stale project operation changed the newly opened project")
	}
}

func TestSequenceIncreasesAcrossSavesAndProjectSwitches(t *testing.T) {
	m, project, initial := localProject(t)
	if initial.Sequence == 0 {
		t.Fatal("snapshots need a nonzero sequence")
	}
	saved, err := m.Save(initial.ID, "main.tf", networkSource+"\n# saved\n", initial.Files[0].Revision)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Sequence <= initial.Sequence {
		t.Fatal("save did not advance sequence")
	}
	demo, err := m.Demo("basic-vpc")
	if err != nil {
		t.Fatal(err)
	}
	if demo.Sequence <= saved.Sequence {
		t.Fatal("demo switch reset sequence")
	}
	opened, err := m.Open(project)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Sequence <= demo.Sequence {
		t.Fatal("folder switch reset sequence")
	}
	reopened, err := m.Open(project)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Sequence <= opened.Sequence {
		t.Fatal("same-content transition did not advance sequence")
	}
}

func TestInstanceIdentityIsStableUntilManagerRestarts(t *testing.T) {
	m, project, initial := localProject(t)
	if len(initial.InstanceID) != 32 || initial.InstanceID != m.InstanceID() {
		t.Fatal("initial snapshot has no instance identity")
	}
	demo, err := m.Demo("basic-vpc")
	if err != nil {
		t.Fatal(err)
	}
	if demo.InstanceID != initial.InstanceID {
		t.Fatal("demo switch changed instance identity")
	}
	reopened, err := m.Open(project)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.InstanceID != initial.InstanceID {
		t.Fatal("project switch changed instance identity")
	}
	restarted, err := New(m.Root())
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if restarted.InstanceID() == initial.InstanceID {
		t.Fatal("new manager reused previous process identity")
	}
}
