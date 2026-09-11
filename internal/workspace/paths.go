// Package workspace manages Terraform projects without executing Terraform.
package workspace

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	MaxFiles        = 100
	MaxFileBytes    = 2 << 20
	MaxProjectBytes = 20 << 20
)

// Error provides a stable machine-readable code at the HTTP boundary.
type Error struct{ Code, Message string }

func (e *Error) Error() string           { return e.Message }
func problem(code, message string) error { return &Error{Code: code, Message: message} }

func revision(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// safePath checks every existing component, rejecting symlinks and traversal.
// Local processes may still race filesystem operations; this is not an OS sandbox.
func safePath(root, candidate string) (string, error) {
	if candidate == "" {
		candidate = root
	}
	if strings.ContainsRune(candidate, 0) {
		return "", problem("invalid_path", "La ruta no es válida.")
	}
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(root, candidate)
	}
	candidate = filepath.Clean(candidate)
	rel, err := filepath.Rel(root, candidate)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", problem("forbidden_path", "La carpeta debe estar dentro de la raíz permitida.")
	}
	current := root
	parts := []string{""}
	if rel != "." {
		parts = append(parts, strings.Split(rel, string(filepath.Separator))...)
	}
	for _, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return "", problem("invalid_path", "No se puede acceder a la ruta seleccionada.")
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", problem("forbidden_path", "Los enlaces simbólicos no están permitidos.")
		}
	}
	return candidate, nil
}

func readFiles(root, dir string) (map[string]string, error) {
	safe, err := safePath(root, dir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(safe)
	if err != nil {
		return nil, problem("io_error", "No se puede leer la carpeta del proyecto.")
	}
	files := make(map[string]string)
	total := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".tf") {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil, problem("forbidden_path", "El proyecto contiene un archivo Terraform enlazado simbólicamente.")
		}
		if len(files) >= MaxFiles {
			return nil, problem("too_large", "El proyecto supera el límite de 100 archivos Terraform.")
		}
		content, err := readFile(root, filepath.Join(safe, entry.Name()))
		if err != nil {
			return nil, err
		}
		total += len(content)
		if total > MaxProjectBytes {
			return nil, problem("too_large", "El proyecto supera el límite de 20 MiB.")
		}
		files[entry.Name()] = content
	}
	return files, nil
}

func readFile(root, path string) (string, error) {
	safe, err := safePath(root, path)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(safe)
	if err != nil || !info.Mode().IsRegular() {
		return "", problem("invalid_path", "Solo se permiten archivos regulares.")
	}
	if info.Size() > MaxFileBytes {
		return "", problem("too_large", "El archivo supera el límite de 2 MiB.")
	}
	f, err := os.Open(safe)
	if err != nil {
		return "", problem("io_error", "No se puede leer el archivo.")
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return "", problem("revision_conflict", "El archivo cambió durante la lectura.")
	}
	b, err := io.ReadAll(io.LimitReader(f, MaxFileBytes+1))
	if err != nil {
		return "", problem("io_error", "No se puede leer el archivo.")
	}
	if len(b) > MaxFileBytes {
		return "", problem("too_large", "El archivo supera el límite de 2 MiB.")
	}
	return string(b), nil
}

func writeFile(root, dir, name, content, expectedRevision string) error {
	path, err := safePath(root, filepath.Join(dir, name))
	if err != nil {
		return err
	}
	current, err := readFile(root, path)
	if err != nil {
		return err
	}
	if revision(current) != expectedRevision {
		return problem("revision_conflict", "El archivo cambió en disco. Revisa la versión actual antes de guardar.")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return problem("io_error", "No se puede comprobar el archivo.")
	}
	f, err := os.CreateTemp(dir, ".terradock-save-*")
	if err != nil {
		return problem("io_error", "No se puede preparar el guardado.")
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err = f.Chmod(info.Mode().Perm()); err != nil {
		return problem("io_error", "No se pueden conservar los permisos del archivo.")
	}
	if _, err = io.WriteString(f, content); err != nil {
		return problem("io_error", "No se puede escribir el archivo.")
	}
	if err = f.Sync(); err != nil {
		return problem("io_error", "No se puede sincronizar el archivo.")
	}
	if err = f.Close(); err != nil {
		return problem("io_error", "No se puede cerrar el archivo temporal.")
	}
	// Recheck just before replace to narrow (not eliminate) external-editor races.
	latest, err := readFile(root, path)
	if err != nil {
		return err
	}
	if revision(latest) != expectedRevision {
		return problem("revision_conflict", "Otro editor modificó el archivo durante el guardado.")
	}
	if _, err = safePath(root, dir); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return problem("io_error", "No se puede reemplazar el archivo.")
	}
	return nil
}

func fingerprint(files map[string]string) string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	h := sha256.New()
	for _, name := range names {
		fmt.Fprintf(h, "%d:%s:%s;", len(name), name, revision(files[name]))
	}
	return hex.EncodeToString(h.Sum(nil))
}

type DirectoryEntry struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	HasTerraform bool   `json:"hasTerraform"`
}
type DirectoryListing struct {
	Path    string           `json:"path"`
	Parent  string           `json:"parent"`
	Root    string           `json:"root"`
	Entries []DirectoryEntry `json:"entries"`
}

func listDirectories(root, candidate string) (DirectoryListing, error) {
	path, err := safePath(root, candidate)
	if err != nil {
		return DirectoryListing{}, err
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return DirectoryListing{}, problem("io_error", "No se puede explorar la carpeta.")
	}
	listing := DirectoryListing{Path: path, Root: root, Entries: []DirectoryEntry{}}
	if path != root {
		listing.Parent = filepath.Dir(path)
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		if entry.Name() == ".git" || entry.Name() == ".terraform" || entry.Name() == "node_modules" {
			continue
		}
		subpath := filepath.Join(path, entry.Name())
		if _, err := safePath(root, subpath); err != nil {
			continue
		}
		subentries, err := os.ReadDir(subpath)
		if err != nil {
			continue
		}
		hasTF := false
		for _, sub := range subentries {
			if !sub.IsDir() && sub.Type()&os.ModeSymlink == 0 && strings.HasSuffix(sub.Name(), ".tf") {
				hasTF = true
				break
			}
		}
		listing.Entries = append(listing.Entries, DirectoryEntry{Name: entry.Name(), Path: subpath, HasTerraform: hasTF})
		if len(listing.Entries) >= 1000 {
			break
		}
	}
	return listing, nil
}
