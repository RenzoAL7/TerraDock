package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/RenzoAL7/TerraDock/internal/terraform"
)

func instanceSpec(name string) terraform.NewResource {
	return terraform.NewResource{Type: "aws_instance", Name: name, Attributes: []terraform.NewAttribute{
		{Name: "ami", Value: "ami-0123456789abcdef0"},
		{Name: "instance_type", Value: "t3.micro"},
		{Name: "subnet_id", Expression: "aws_subnet.public.id"},
	}}
}

func TestResourceDraftAppendsOverTheDraftWithoutWriting(t *testing.T) {
	m, project, initial := localProject(t)
	draft := strings.Replace(networkSource, "# preserve this comment", "# unsaved note", 1)
	updated, line, err := m.ResourceDraft(initial.ID, "main.tf", draft, initial.Files[0].Revision, instanceSpec("web"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(updated, draft) || !strings.Contains(updated[len(draft):], `resource "aws_instance" "web"`) {
		t.Fatalf("block was not appended to the draft: %q", updated)
	}
	if line != strings.Count(draft, "\n")+2 {
		t.Fatalf("unexpected block line %d", line)
	}
	disk, _ := os.ReadFile(filepath.Join(project, "main.tf"))
	if string(disk) != networkSource || m.Snapshot().Sequence != initial.Sequence {
		t.Fatal("resource-draft wrote to disk or changed the project")
	}
	// The draft is saved by the usual revision-checked save.
	saved, err := m.Save(initial.ID, "main.tf", updated, initial.Files[0].Revision)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range saved.Resources {
		found = found || (r.ID == "aws_instance.web" && r.Line == line && r.ParentID == "aws_subnet.public")
	}
	if !found {
		t.Fatalf("saved project lacks the new resource: %+v", saved.Resources)
	}
}

func TestResourceDraftRejectsDuplicateInvalidAndStale(t *testing.T) {
	m, project, initial := localProject(t)
	revision := initial.Files[0].Revision
	_, _, err := m.ResourceDraft(initial.ID, "main.tf", networkSource, revision, terraform.NewResource{Type: "aws_subnet", Name: "public"})
	errorCode(t, err, "duplicate_resource")
	_, _, err = m.ResourceDraft(initial.ID, "main.tf", networkSource, revision, instanceSpec("web server"))
	errorCode(t, err, "invalid_resource")
	_, _, err = m.ResourceDraft(initial.ID, "main.tf", `resource "aws_vpc" {`, revision, instanceSpec("web"))
	errorCode(t, err, "invalid_resource")
	_, _, err = m.ResourceDraft(initial.ID, "missing.tf", "", revision, instanceSpec("web"))
	errorCode(t, err, "not_found")
	_, _, err = m.ResourceDraft("other", "main.tf", networkSource, revision, instanceSpec("web"))
	errorCode(t, err, "project_conflict")
	// The file changed on disk: the block must not land on an outdated base.
	external := strings.Replace(networkSource, "10.0.1.0/24", "10.0.9.0/24", 1)
	if err := os.WriteFile(filepath.Join(project, "main.tf"), []byte(external), 0640); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Save(initial.ID, "main.tf", networkSource, revision); err == nil {
		t.Fatal("stale save accepted")
	}
	_, _, err = m.ResourceDraft(initial.ID, "main.tf", networkSource, revision, instanceSpec("web"))
	errorCode(t, err, "revision_conflict")
	_, _, err = m.ResourceDraft(initial.ID, "main.tf", networkSource, "", instanceSpec("web"))
	errorCode(t, err, "revision_conflict")
}

func TestCreateResourceFileWritesANewFileOnly(t *testing.T) {
	m, project, initial := localProject(t)
	next, err := m.CreateResourceFile(initial.ID, "compute.tf", instanceSpec("web"))
	if err != nil {
		t.Fatal(err)
	}
	disk, err := os.ReadFile(filepath.Join(project, "compute.tf"))
	if err != nil || !strings.HasPrefix(string(disk), `resource "aws_instance" "web" {`) {
		t.Fatalf("new file not written: %q, %v", disk, err)
	}
	// Same permissions as the .tf next to it (main.tf is 0640), whatever the umask.
	if info, err := os.Stat(filepath.Join(project, "compute.tf")); err != nil || info.Mode().Perm() != 0640 {
		t.Fatalf("new file permissions differ from its neighbour: %v, %v", info.Mode(), err)
	}
	if main, _ := os.ReadFile(filepath.Join(project, "main.tf")); string(main) != networkSource {
		t.Fatal("creating a file changed another file")
	}
	if len(next.Files) != 2 || next.Files[0].Path != "compute.tf" || next.Files[0].Content != string(disk) || next.Sequence <= initial.Sequence {
		t.Fatalf("snapshot does not include the new file: %+v", next.Files)
	}
	// A second creation never replaces the file, and duplicates are refused
	// across files.
	_, err = m.CreateResourceFile(initial.ID, "compute.tf", instanceSpec("api"))
	errorCode(t, err, "file_exists")
	_, err = m.CreateResourceFile(initial.ID, "other.tf", instanceSpec("web"))
	errorCode(t, err, "duplicate_resource")
	if _, err := os.Stat(filepath.Join(project, "other.tf")); !os.IsNotExist(err) {
		t.Fatal("a rejected creation left a file behind")
	}
	// A file that exists on disk but has not reached the snapshot yet.
	if err := os.WriteFile(filepath.Join(project, "late.tf"), []byte("# external\n"), 0640); err != nil {
		t.Fatal(err)
	}
	_, err = m.CreateResourceFile(m.Snapshot().ID, "late.tf", instanceSpec("api"))
	errorCode(t, err, "file_exists")
	if late, _ := os.ReadFile(filepath.Join(project, "late.tf")); string(late) != "# external\n" {
		t.Fatal("an existing file was replaced")
	}
}

func TestCreateResourceFileStaysInsideTheProject(t *testing.T) {
	m, project, initial := localProject(t)
	root := filepath.Dir(project)
	for _, name := range []string{"../outside.tf", "sub/x.tf", `..\x.tf`, "/tmp/x.tf", ".hidden.tf", "x.tf.json", "x.txt", ".tf", "a b.tf", "", "-x.tf",
		"nul.tf", "NUL.tf", "con.tf", "Aux.tf", "prn.backup.tf", "com1.tf", "LPT9.tf", "com0.tf"} {
		_, err := m.CreateResourceFile(initial.ID, name, instanceSpec("web"))
		errorCode(t, err, "invalid_path")
	}
	if _, err := os.Stat(filepath.Join(root, "outside.tf")); !os.IsNotExist(err) {
		t.Fatal("file created outside the project")
	}
	// A symlink planted where the new file goes is never followed.
	target := filepath.Join(t.TempDir(), "target.tf")
	if err := os.Symlink(target, filepath.Join(project, "linked.tf")); err != nil {
		t.Fatal(err)
	}
	_, err := m.CreateResourceFile(initial.ID, "linked.tf", instanceSpec("web"))
	errorCode(t, err, "file_exists")
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("creation followed a symlink out of the project")
	}
}

func TestNewFileNamesAcceptPortableNamesOnly(t *testing.T) {
	for _, name := range []string{"main.tf", "a.tf", "net-work_2.tf", "console.tf", "nullable.tf", "com10.tf", "lpt.tf"} {
		if !validNewFileName(name) {
			t.Errorf("%q should be accepted", name)
		}
	}
}

func TestNewFileTakesTheNeighbourModeWithOwnerAccess(t *testing.T) {
	for _, tc := range []struct {
		name      string
		neighbour os.FileMode
		hasTF     bool
		want      os.FileMode
	}{
		{"read-only neighbour", 0o444, true, 0o644},
		{"neighbour without permissions", 0o000, true, 0o600},
		{"private neighbour", 0o640, true, 0o640},
		{"no neighbour", 0, false, 0o644},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			project := filepath.Join(root, "project")
			if err := os.Mkdir(project, 0o755); err != nil {
				t.Fatal(err)
			}
			if tc.hasTF {
				neighbour := filepath.Join(project, "main.tf")
				if err := os.WriteFile(neighbour, []byte("# main\n"), 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Chmod(neighbour, tc.neighbour); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.Chmod(neighbour, 0o600) })
			}
			if err := createFile(root, project, "new.tf", "# new\n"); err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(filepath.Join(project, "new.tf"))
			if err != nil || info.Mode().Perm() != tc.want {
				t.Fatalf("mode = %v (%v), want %v", info.Mode().Perm(), err, tc.want)
			}
			if got, err := readFile(root, filepath.Join(project, "new.tf")); err != nil || got != "# new\n" {
				t.Fatalf("new file is not readable back: %q, %v", got, err)
			}
		})
	}
}

func TestCreateFileDoesNotFollowADirectorySwappedForASymlink(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	beforeCreate = func() {
		// After the path check, the project becomes a link out of the root.
		if err := os.Rename(project, project+".old"); err != nil {
			t.Error(err)
		}
		if err := os.Symlink(outside, project); err != nil {
			t.Error(err)
		}
	}
	t.Cleanup(func() { beforeCreate = func() {} })
	err := createFile(root, project, "new.tf", "# new\n")
	errorCode(t, err, "io_error")
	if _, err := os.Stat(filepath.Join(outside, "new.tf")); !os.IsNotExist(err) {
		t.Fatal("the new file was written outside the allowed root")
	}
}

func TestCreateResourceFileInDemoStaysInMemory(t *testing.T) {
	root := t.TempDir()
	m, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	demo := m.Snapshot()
	next, err := m.CreateResourceFile(demo.ID, "extra.tf", terraform.NewResource{Type: "aws_s3_bucket", Name: "extra"})
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Files) != len(demo.Files)+1 {
		t.Fatal("demo project did not gain the file")
	}
	if entries, _ := os.ReadDir(root); len(entries) != 0 {
		t.Fatal("demo creation wrote to disk")
	}
}
