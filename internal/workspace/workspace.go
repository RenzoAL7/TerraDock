package workspace

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/RenzoAL7/TerraDock/examples"
	"github.com/RenzoAL7/TerraDock/internal/terraform"
)

type Snapshot struct {
	InstanceID string `json:"instanceId"`
	ID         string `json:"id"`
	Name       string `json:"name"`
	Mode       string `json:"mode"`
	Path       string `json:"path"`
	Revision   string `json:"revision"`
	// Sequence orders snapshots across every project in one server process.
	// It is independent of content hashes, so clients can reject late responses.
	Sequence    uint64                 `json:"sequence"`
	Files       []terraform.SourceFile `json:"files"`
	Resources   []terraform.Resource   `json:"resources"`
	Edges       []terraform.Edge       `json:"edges"`
	Diagnostics []terraform.Diagnostic `json:"diagnostics"`
	Findings    []terraform.Finding    `json:"findings"`
	Valid       bool                   `json:"valid"`
}

type Manager struct {
	mu          sync.Mutex
	root        string
	instanceID  string
	current     Snapshot
	files       map[string]string
	fingerprint string
	generation  uint64
	subscribers map[chan Snapshot]struct{}
	rewatch     chan struct{}
	stop        chan struct{}
	done        chan struct{}
	once        sync.Once
}

func New(root string) (*Manager, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace root: %w", err)
	}
	canonical, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace root: %w", err)
	}
	info, err := os.Stat(canonical)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("workspace root must be an existing directory")
	}
	instanceBytes := make([]byte, 16)
	if _, err := rand.Read(instanceBytes); err != nil {
		return nil, fmt.Errorf("create instance ID: %w", err)
	}
	m := &Manager{root: canonical, instanceID: hex.EncodeToString(instanceBytes), subscribers: make(map[chan Snapshot]struct{}), rewatch: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
	if _, err := m.Demo("web-app"); err != nil {
		return nil, err
	}
	go m.watch()
	return m, nil
}

func (m *Manager) Root() string { return m.root }

// InstanceID is a public generation identifier, never an authentication secret.
func (m *Manager) InstanceID() string { return m.instanceID }
func (m *Manager) Close()             { m.once.Do(func() { close(m.stop) }); <-m.done }
func (m *Manager) Snapshot() Snapshot { m.mu.Lock(); defer m.mu.Unlock(); return m.current }
func (m *Manager) Directories(path string) (DirectoryListing, error) {
	return listDirectories(m.root, path)
}

func (m *Manager) Demo(template string) (Snapshot, error) {
	files, err := examples.Load(template)
	if err != nil {
		return Snapshot{}, problem("unsupported_template", "La plantilla solicitada no existe.")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.current = Snapshot{ID: "demo-" + template, Name: template, Mode: "demo", Path: ""}
	m.apply(files, false)
	m.signalRewatch()
	return m.current, nil
}

func (m *Manager) Open(path string) (Snapshot, error) {
	safe, err := safePath(m.root, path)
	if err != nil {
		return Snapshot{}, err
	}
	files, err := readFiles(m.root, safe)
	if err != nil {
		return Snapshot{}, err
	}
	if len(files) == 0 {
		return Snapshot{}, problem("no_terraform", "La carpeta no contiene archivos .tf en su raíz. Selecciona el módulo que quieres abrir.")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.current = Snapshot{ID: "local-" + revision(safe)[:16], Name: filepath.Base(safe), Mode: "local", Path: safe}
	m.apply(files, false)
	m.signalRewatch()
	return m.current, nil
}

func (m *Manager) Save(projectID, path, content, expected string) (Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if projectID == "" || projectID != m.current.ID {
		return Snapshot{}, problem("project_conflict", "El proyecto abierto cambió. Revisa el proyecto actual antes de guardar.")
	}
	return m.save(path, content, expected)
}

func (m *Manager) save(path, content, expected string) (Snapshot, error) {
	if path == "" || filepath.Base(path) != path || strings.ContainsAny(path, "/\\") || !strings.HasSuffix(path, ".tf") {
		return Snapshot{}, problem("invalid_path", "Selecciona un archivo .tf del módulo abierto.")
	}
	old, ok := m.files[path]
	if !ok {
		return Snapshot{}, problem("not_found", "El archivo no pertenece al proyecto abierto.")
	}
	if expected == "" || expected != revision(old) {
		return Snapshot{}, problem("revision_conflict", "La versión del archivo cambió. Revisa los cambios antes de guardar.")
	}
	if len(content) > MaxFileBytes {
		return Snapshot{}, problem("too_large", "El archivo supera el límite de 2 MiB.")
	}
	total := len(content)
	for name, body := range m.files {
		if name != path {
			total += len(body)
		}
	}
	if total > MaxProjectBytes {
		return Snapshot{}, problem("too_large", "El proyecto supera el límite de 20 MiB.")
	}
	if m.current.Mode == "local" {
		if err := writeFile(m.root, m.current.Path, path, content, expected); err != nil {
			// Publish the externally changed version while leaving frontend drafts intact.
			m.refreshLocked()
			return Snapshot{}, err
		}
	}
	files := make(map[string]string, len(m.files))
	for name, body := range m.files {
		files[name] = body
	}
	files[path] = content
	m.apply(files, true)
	return m.current, nil
}

func (m *Manager) Property(projectID, resourceID, property string, value any, expected string) (Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if projectID == "" || projectID != m.current.ID {
		return Snapshot{}, problem("project_conflict", "El proyecto abierto cambió. Revisa el proyecto actual antes de guardar.")
	}
	if !m.current.Valid {
		return Snapshot{}, problem("invalid_property", "Corrige los errores de sintaxis antes de editar propiedades.")
	}
	// The parser validates resource identity and allowlisted literal properties.
	for _, file := range m.current.Files {
		updated, err := terraform.EditLiteral(file.Content, file.Path, resourceID, property, value)
		if err == nil {
			return m.save(file.Path, updated, expected)
		}
	}
	return Snapshot{}, problem("invalid_property", "La propiedad no admite esta edición. Solo se pueden modificar literales compatibles.")
}

func (m *Manager) apply(files map[string]string, preserve bool) {
	analysis := terraform.Parse(files)
	next := m.current
	next.InstanceID = m.instanceID
	next.Files = make([]terraform.SourceFile, 0, len(files))
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		next.Files = append(next.Files, terraform.SourceFile{Path: name, Content: files[name], Revision: revision(files[name])})
	}
	if analysis.Valid || !preserve {
		next.Resources = analysis.Resources
		next.Edges = analysis.Edges
		next.Findings = analysis.Findings
	}
	next.Diagnostics = analysis.Diagnostics
	next.Valid = analysis.Valid
	m.files = files
	m.fingerprint = fingerprint(files)
	m.generation++
	next.Sequence = m.generation
	next.Revision = fmt.Sprintf("%d-%s", m.generation, m.fingerprint[:12])
	m.current = next
	m.publish(next)
}

func (m *Manager) Subscribe() (chan Snapshot, func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ch := make(chan Snapshot, 1)
	m.subscribers[ch] = struct{}{}
	ch <- m.current
	return ch, func() { m.mu.Lock(); delete(m.subscribers, ch); m.mu.Unlock() }
}

func (m *Manager) publish(snapshot Snapshot) {
	for ch := range m.subscribers {
		select {
		case ch <- snapshot:
		default:
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- snapshot:
			default:
			}
		}
	}
}

func (m *Manager) refreshLocked() {
	if m.current.Mode != "local" {
		return
	}
	files, err := readFiles(m.root, m.current.Path)
	if err != nil {
		// Preserve source and graph on a transient filesystem problem. The error
		// state changes the project revision and is cleared after a successful read.
		marker := "error:" + err.Error()
		if m.fingerprint == marker {
			return
		}
		m.fingerprint = marker
		m.generation++
		m.current.Sequence = m.generation
		m.current.Valid = false
		m.current.Revision = fmt.Sprintf("%d-io-error", m.generation)
		m.current.Diagnostics = []terraform.Diagnostic{{Severity: "error", Message: err.Error()}}
		m.publish(m.current)
		return
	}
	if fingerprint(files) != m.fingerprint {
		m.apply(files, true)
	}
}

// Tuning for the file watcher. Native events give near-instant updates; the
// poll is a safety net for filesystems that drop or never deliver events.
const (
	eventDebounce     = 25 * time.Millisecond
	pollWithEvents    = 2 * time.Second
	pollWithoutEvents = 300 * time.Millisecond
)

func (m *Manager) signalRewatch() {
	select {
	case m.rewatch <- struct{}{}:
	default:
	}
}

func (m *Manager) watch() {
	defer close(m.done)
	watcher, err := fsnotify.NewWatcher()
	var events <-chan fsnotify.Event
	var watchErrors <-chan error
	interval := pollWithoutEvents
	if err == nil {
		defer watcher.Close()
		events, watchErrors = watcher.Events, watcher.Errors
		interval = pollWithEvents
	}
	poll := time.NewTicker(interval)
	defer poll.Stop()
	watched := ""
	follow := func() {
		if watcher == nil {
			return
		}
		m.mu.Lock()
		target := ""
		if m.current.Mode == "local" {
			target = m.current.Path
		}
		m.mu.Unlock()
		if target == watched {
			return
		}
		if watched != "" {
			_ = watcher.Remove(watched)
		}
		watched = ""
		if target != "" && watcher.Add(target) == nil {
			watched = target
		}
	}
	refresh := func() {
		m.mu.Lock()
		m.refreshLocked()
		m.mu.Unlock()
	}
	var debounce <-chan time.Time
	follow()
	for {
		select {
		case <-m.stop:
			return
		case <-m.rewatch:
			follow()
		case event, ok := <-events:
			if !ok {
				events = nil
				poll.Reset(pollWithoutEvents)
				continue
			}
			// Editors often save through temp files and renames; any .tf or
			// .tf.json entry change (or the directory itself) triggers a re-read.
			if isConfigFile(event.Name) || event.Name == watched {
				if debounce == nil {
					debounce = time.After(eventDebounce)
				}
			}
		case _, ok := <-watchErrors:
			if !ok {
				watchErrors = nil
			}
		case <-debounce:
			debounce = nil
			refresh()
		case <-poll.C:
			follow()
			refresh()
		}
	}
}

// Preview is the analysis of unsaved editor content layered over the project.
// It never mutates the workspace and is the basis of live diagram updates.
type Preview struct {
	ProjectID   string                 `json:"projectId"`
	Revision    string                 `json:"revision"`
	Resources   []terraform.Resource   `json:"resources"`
	Edges       []terraform.Edge       `json:"edges"`
	Diagnostics []terraform.Diagnostic `json:"diagnostics"`
	Findings    []terraform.Finding    `json:"findings"`
	Valid       bool                   `json:"valid"`
}

// Analyze parses the open project with the given file contents replacing the
// stored ones. Only files that belong to the project can be overridden.
func (m *Manager) Analyze(projectID string, overrides map[string]string) (Preview, error) {
	m.mu.Lock()
	if projectID == "" || projectID != m.current.ID {
		m.mu.Unlock()
		return Preview{}, problem("project_conflict", "El proyecto abierto cambió. Revisa el proyecto actual.")
	}
	files := make(map[string]string, len(m.files))
	for name, body := range m.files {
		files[name] = body
	}
	revision := m.current.Revision
	m.mu.Unlock()
	total := 0
	for name, body := range overrides {
		if _, ok := files[name]; !ok {
			return Preview{}, problem("not_found", "El archivo no pertenece al proyecto abierto.")
		}
		if len(body) > MaxFileBytes {
			return Preview{}, problem("too_large", "El archivo supera el límite de 2 MiB.")
		}
		files[name] = body
	}
	for _, body := range files {
		total += len(body)
	}
	if total > MaxProjectBytes {
		return Preview{}, problem("too_large", "El proyecto supera el límite de 20 MiB.")
	}
	analysis := terraform.Parse(files)
	return Preview{ProjectID: projectID, Revision: revision, Resources: analysis.Resources, Edges: analysis.Edges, Diagnostics: analysis.Diagnostics, Findings: analysis.Findings, Valid: analysis.Valid}, nil
}

// EditDraft applies a visual literal edit to unsaved content and returns the
// new text. Persisting it is a separate, revision-checked save.
func (m *Manager) EditDraft(projectID, path, content, resourceID, property string, value any) (string, error) {
	m.mu.Lock()
	_, known := m.files[path]
	current := m.current.ID
	m.mu.Unlock()
	if projectID == "" || projectID != current {
		return "", problem("project_conflict", "El proyecto abierto cambió. Revisa el proyecto actual.")
	}
	if !known {
		return "", problem("not_found", "El archivo no pertenece al proyecto abierto.")
	}
	if len(content) > MaxFileBytes {
		return "", problem("too_large", "El archivo supera el límite de 2 MiB.")
	}
	updated, err := terraform.EditLiteral(content, path, resourceID, property, value)
	if err != nil {
		return "", problem("invalid_property", err.Error())
	}
	return updated, nil
}

// Files returns a copy of the saved project files and its identity, for tools
// (such as the Floci runner) that must work on confirmed content only.
func (m *Manager) Files() (Snapshot, map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	files := make(map[string]string, len(m.files))
	for name, body := range m.files {
		files[name] = body
	}
	return m.current, files
}
