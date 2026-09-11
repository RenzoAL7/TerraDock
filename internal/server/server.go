// Package server exposes TerraDock on a loopback-only, same-origin HTTP surface.
package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/RenzoAL7/TerraDock/internal/workspace"
)

const Version = "0.1.0-demo"

type Server struct {
	workspace *workspace.Manager
	token     string
	assets    string
	devOrigin string
}

// Options permits one exact loopback origin for Vite's development proxy.
// This never enables CORS: production assets and API share one origin.
type Options struct{ DevOrigin string }

func New(manager *workspace.Manager, assets string, options ...Options) (*Server, error) {
	if manager == nil {
		return nil, fmt.Errorf("workspace manager is required")
	}
	if len(options) > 1 {
		return nil, fmt.Errorf("only one server options value is allowed")
	}
	devOrigin := ""
	if len(options) == 1 {
		devOrigin = options[0].DevOrigin
	}
	if devOrigin != "" {
		u, err := url.Parse(devOrigin)
		if err != nil || !validOrigin(u) || u.Scheme != "http" || !loopbackHost(u.Host) || u.Port() == "" {
			return nil, fmt.Errorf("dev-origin must be an exact HTTP loopback origin with a port")
		}
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return &Server{workspace: manager, token: hex.EncodeToString(b), assets: assets, devOrigin: devOrigin}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/session", s.session)
	mux.HandleFunc("GET /api/project", func(w http.ResponseWriter, r *http.Request) { respond(w, http.StatusOK, s.workspace.Snapshot()) })
	mux.HandleFunc("GET /api/directories", s.directories)
	mux.HandleFunc("POST /api/demo", s.demo)
	mux.HandleFunc("POST /api/open", s.open)
	mux.HandleFunc("PUT /api/files", s.save)
	mux.HandleFunc("PATCH /api/properties", s.property)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "not_found", "La ruta de API no existe.")
	})
	mux.HandleFunc("/", s.static)
	return s.security(mux)
}

func (s *Server) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		if !loopbackHost(r.Host) {
			fail(w, http.StatusForbidden, "invalid_host", "El servidor solo acepta hosts de loopback.")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			scheme := "http"
			if r.TLS != nil {
				scheme = "https"
			}
			if err != nil || !validOrigin(u) || (origin != scheme+"://"+r.Host && origin != s.devOrigin) {
				fail(w, http.StatusForbidden, "invalid_origin", "La petición debe proceder del mismo origen local.")
				return
			}
		}
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
			fail(w, http.StatusForbidden, "invalid_origin", "Las peticiones entre sitios no están permitidas.")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			provided := r.Header.Get("X-TerraDock-Session")
			if subtle.ConstantTimeCompare([]byte(provided), []byte(s.token)) != 1 {
				fail(w, http.StatusForbidden, "invalid_session", "La sesión local no es válida. Recarga la aplicación.")
				return
			}
			mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || mediaType != "application/json" {
				fail(w, http.StatusUnsupportedMediaType, "invalid_content_type", "Se requiere application/json.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func validOrigin(u *url.URL) bool {
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.Path == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && u.User == nil && u.Opaque == ""
}

func loopbackHost(host string) bool {
	name, _, err := net.SplitHostPort(host)
	if err != nil {
		name = host
	}
	name = strings.Trim(name, "[]")
	if strings.EqualFold(name, "localhost") {
		return true
	}
	ip := net.ParseIP(name)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	respond(w, http.StatusOK, map[string]any{"token": s.token, "instanceId": s.workspace.InstanceID(), "root": s.workspace.Root(), "mode": s.workspace.Snapshot().Mode, "version": Version})
}

func (s *Server) directories(w http.ResponseWriter, r *http.Request) {
	listing, err := s.workspace.Directories(r.URL.Query().Get("path"))
	if err != nil {
		respondError(w, err)
		return
	}
	respond(w, http.StatusOK, listing)
}

func (s *Server) demo(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Template string `json:"template"`
	}
	if !decode(w, r, &request) {
		return
	}
	snapshot, err := s.workspace.Demo(request.Template)
	if err != nil {
		respondError(w, err)
		return
	}
	respond(w, http.StatusOK, snapshot)
}

func (s *Server) open(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Path string `json:"path"`
	}
	if !decode(w, r, &request) {
		return
	}
	snapshot, err := s.workspace.Open(request.Path)
	if err != nil {
		respondError(w, err)
		return
	}
	respond(w, http.StatusOK, snapshot)
}

func (s *Server) save(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ProjectID        string `json:"projectId"`
		Path             string `json:"path"`
		Content          string `json:"content"`
		ExpectedRevision string `json:"expectedRevision"`
	}
	if !decode(w, r, &request) {
		return
	}
	snapshot, err := s.workspace.Save(request.ProjectID, request.Path, request.Content, request.ExpectedRevision)
	if err != nil {
		respondError(w, err)
		return
	}
	respond(w, http.StatusOK, snapshot)
}

func (s *Server) property(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ProjectID        string `json:"projectId"`
		ResourceID       string `json:"resourceId"`
		Property         string `json:"property"`
		Value            any    `json:"value"`
		ExpectedRevision string `json:"expectedRevision"`
	}
	if !decode(w, r, &request) {
		return
	}
	snapshot, err := s.workspace.Property(request.ProjectID, request.ResourceID, request.Property, request.Value, request.ExpectedRevision)
	if err != nil {
		respondError(w, err)
		return
	}
	respond(w, http.StatusOK, snapshot)
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, workspace.MaxFileBytes*6+4096)
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			fail(w, http.StatusRequestEntityTooLarge, "too_large", "La petición supera el tamaño permitido.")
		} else {
			fail(w, http.StatusBadRequest, "invalid_json", "El cuerpo JSON no es válido.")
		}
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(w, http.StatusBadRequest, "invalid_json", "Solo se permite un objeto JSON por petición.")
		return false
	}
	return true
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	respond(w, status, map[string]string{"error": message, "code": code})
}
func respondError(w http.ResponseWriter, err error) {
	var typed *workspace.Error
	if !errors.As(err, &typed) {
		fail(w, http.StatusInternalServerError, "internal_error", "No se pudo completar la operación.")
		return
	}
	status := http.StatusBadRequest
	switch typed.Code {
	case "revision_conflict", "project_conflict":
		status = http.StatusConflict
	case "forbidden_path":
		status = http.StatusForbidden
	case "not_found":
		status = http.StatusNotFound
	case "too_large":
		status = http.StatusRequestEntityTooLarge
	case "io_error":
		status = http.StatusInternalServerError
	}
	fail(w, status, typed.Code, typed.Message)
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, http.StatusInternalServerError, "stream_unavailable", "El servidor no admite este stream.")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	updates, cancel := s.workspace.Subscribe()
	defer cancel()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	controller := http.NewResponseController(w)
	for {
		select {
		case <-r.Context().Done():
			return
		case snapshot := <-updates:
			data, err := json.Marshal(snapshot)
			if err != nil {
				return
			}
			_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if _, err := fmt.Fprintf(w, "event: project\ndata: %s\n\n", data); err != nil {
				return
			}
			flusher.Flush()
		case <-ticker.C:
			_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api") {
		fail(w, http.StatusNotFound, "not_found", "La ruta de API no existe.")
		return
	}
	clean := filepath.Clean(filepath.FromSlash("/" + r.URL.Path))
	path := filepath.Join(s.assets, strings.TrimPrefix(clean, string(filepath.Separator)))
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		if strings.Contains(filepath.Base(path), "-") && strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFile(w, r, path)
		return
	}
	if filepath.Ext(r.URL.Path) != "" {
		http.NotFound(w, r)
		return
	}
	index := filepath.Join(s.assets, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.Error(w, "TerraDock frontend is not built. Run make build, or use the Vite development server.", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, index)
}
