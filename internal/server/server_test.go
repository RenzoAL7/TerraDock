package server

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/RenzoAL7/TerraDock/internal/workspace"
)

const testSource = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`

type testAPI struct {
	server *httptest.Server
	app    *Server
	root   string
	token  string
}

func setupAPI(t *testing.T, options ...Options) *testAPI {
	t.Helper()
	root := t.TempDir()
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "main.tf"), []byte(testSource), 0600); err != nil {
		t.Fatal(err)
	}
	manager, err := workspace.New(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(manager.Close)
	assets := t.TempDir()
	if err := os.WriteFile(filepath.Join(assets, "index.html"), []byte("<!doctype html><title>TerraDock</title>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(assets, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "assets", "main-abc123.js"), []byte("console.log('local')"), 0600); err != nil {
		t.Fatal(err)
	}
	app, err := New(manager, assets, options...)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	api := &testAPI{server: server, app: app, root: root}
	response := api.request(t, "GET", "/api/session", "", nil)
	defer response.Body.Close()
	var session struct {
		Token string `json:"token"`
		Root  string `json:"root"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&session) != nil || len(session.Token) != 64 || session.Root != root {
		t.Fatal("session initialization failed")
	}
	api.token = session.Token
	return api
}

func (a *testAPI) request(t *testing.T, method, path, body string, headers map[string]string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, a.server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", a.server.URL)
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	if a.token != "" {
		request.Header.Set("X-TerraDock-Session", a.token)
	}
	for key, value := range headers {
		if key == "Host" {
			request.Host = value
		} else {
			request.Header.Set(key, value)
		}
	}
	response, err := a.server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func assertStatus(t *testing.T, response *http.Response, expected int) {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != expected {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("want HTTP %d, got %d: %s", expected, response.StatusCode, body)
	}
}

func projectFrom(t *testing.T, response *http.Response) workspace.Snapshot {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("HTTP %d: %s", response.StatusCode, body)
	}
	var snapshot workspace.Snapshot
	if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func bodyJSON(t *testing.T, value any) string {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}

func TestHTTPProjectEditAndDiskCAS(t *testing.T) {
	api := setupAPI(t)
	initial := projectFrom(t, api.request(t, "POST", "/api/open", bodyJSON(t, map[string]string{"path": api.root}), nil))
	if initial.Mode != "local" || !initial.Valid || len(initial.Resources) != 1 {
		t.Fatal("folder was not analyzed")
	}
	property := bodyJSON(t, map[string]any{"projectId": initial.ID, "resourceId": "aws_vpc.main", "property": "cidr_block", "value": "10.1.0.0/16", "expectedRevision": initial.Files[0].Revision})
	changed := projectFrom(t, api.request(t, "PATCH", "/api/properties", property, nil))
	if changed.Files[0].Content != strings.Replace(testSource, "10.0.0.0/16", "10.1.0.0/16", 1) {
		t.Fatal("property change did not modify the source")
	}
	assertStatus(t, api.request(t, "PATCH", "/api/properties", property, nil), http.StatusConflict)
	invalidSave := bodyJSON(t, map[string]string{"projectId": changed.ID, "path": "main.tf", "content": `resource "aws_vpc"`, "expectedRevision": changed.Files[0].Revision})
	invalid := projectFrom(t, api.request(t, "PUT", "/api/files", invalidSave, nil))
	if invalid.Valid || len(invalid.Diagnostics) == 0 || len(invalid.Resources) != len(changed.Resources) {
		t.Fatal("invalid source was not reported with last valid graph")
	}
	actual, err := os.ReadFile(filepath.Join(api.root, "main.tf"))
	if err != nil || string(actual) != `resource "aws_vpc"` {
		t.Fatal("editor save did not reach the original file")
	}
}

func TestHTTPSecurityBoundary(t *testing.T) {
	api := setupAPI(t)
	cases := []struct {
		name, method, path, body string
		headers                  map[string]string
		status                   int
	}{
		{"missing token", "POST", "/api/demo", `{"template":"basic-vpc"}`, map[string]string{"X-TerraDock-Session": ""}, http.StatusForbidden},
		{"wrong token", "POST", "/api/demo", `{"template":"basic-vpc"}`, map[string]string{"X-TerraDock-Session": "incorrect"}, http.StatusForbidden},
		{"foreign origin", "GET", "/api/session", "", map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden},
		{"null origin", "GET", "/api/project", "", map[string]string{"Origin": "null"}, http.StatusForbidden},
		{"cross site", "GET", "/api/project", "", map[string]string{"Sec-Fetch-Site": "cross-site"}, http.StatusForbidden},
		{"DNS rebind", "GET", "/api/session", "", map[string]string{"Host": "evil.example", "Origin": "http://evil.example"}, http.StatusForbidden},
		{"remote IP host", "GET", "/api/project", "", map[string]string{"Host": "192.0.2.1"}, http.StatusForbidden},
		{"form content type", "POST", "/api/open", `{}`, map[string]string{"Content-Type": "text/plain"}, http.StatusUnsupportedMediaType},
		{"fake json content type", "POST", "/api/open", `{}`, map[string]string{"Content-Type": "application/json-malicious"}, http.StatusUnsupportedMediaType},
		{"unknown field", "POST", "/api/open", `{"path":".","extra":true}`, nil, http.StatusBadRequest},
		{"malformed JSON", "POST", "/api/open", `{`, nil, http.StatusBadRequest},
		{"trailing JSON", "POST", "/api/open", `{} {}`, nil, http.StatusBadRequest},
		{"path escape", "POST", "/api/open", `{"path":".."}`, nil, http.StatusForbidden},
		{"missing route", "GET", "/api/does-not-exist", "", nil, http.StatusNotFound},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			assertStatus(t, api.request(t, item.method, item.path, item.body, item.headers), item.status)
		})
	}
	response := api.request(t, "GET", "/api/project", "", nil)
	defer response.Body.Close()
	if response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("X-Frame-Options") != "DENY" || response.Header.Get("Content-Security-Policy") == "" || response.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("security headers are missing or CORS was enabled")
	}
}

func TestDevelopmentProxyAllowsOnlyExactConfiguredOrigin(t *testing.T) {
	api := setupAPI(t, Options{DevOrigin: "http://127.0.0.1:5173"})
	assertStatus(t, api.request(t, "POST", "/api/demo", `{"template":"basic-vpc"}`, map[string]string{"Origin": "http://127.0.0.1:5173"}), http.StatusOK)
	assertStatus(t, api.request(t, "GET", "/api/project", "", map[string]string{"Origin": "http://127.0.0.1:5174"}), http.StatusForbidden)
	assertStatus(t, api.request(t, "GET", "/api/project", "", map[string]string{"Origin": "http://localhost:5173"}), http.StatusForbidden)
	for _, origin := range []string{"https://evil.example", "http://127.0.0.1:5173/path", "http://127.0.0.1", "http://user@localhost:5173", "http://localhost:5173?"} {
		if _, err := New(api.app.workspace, api.app.assets, Options{DevOrigin: origin}); err == nil {
			t.Fatalf("accepted invalid dev origin %q", origin)
		}
	}
}

func TestHTTPEventsStreamExternalChangeAndInvalidGraph(t *testing.T) {
	api := setupAPI(t)
	projectFrom(t, api.request(t, "POST", "/api/open", `{"path":"."}`, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "GET", api.server.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := api.server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatal("SSE stream did not open")
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 1024), workspace.MaxFileBytes*6)
	readEvent := func() workspace.Snapshot {
		t.Helper()
		eventName := ""
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "event: ") {
				eventName = strings.TrimPrefix(line, "event: ")
			}
			if strings.HasPrefix(line, "data: ") {
				if eventName != "project" {
					t.Fatalf("unexpected SSE event %s", eventName)
				}
				var snapshot workspace.Snapshot
				if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &snapshot); err != nil {
					t.Fatal(err)
				}
				return snapshot
			}
		}
		t.Fatalf("SSE closed before expected update: %v", scanner.Err())
		return workspace.Snapshot{}
	}
	initial := readEvent()
	if !initial.Valid || len(initial.Resources) != 1 {
		t.Fatal("initial SSE snapshot missing")
	}
	if err := os.WriteFile(filepath.Join(api.root, "main.tf"), []byte(`resource "broken" {`), 0600); err != nil {
		t.Fatal(err)
	}
	invalid := readEvent()
	if invalid.Valid || len(invalid.Resources) != 1 || len(invalid.Diagnostics) == 0 {
		t.Fatal("SSE invalid update did not preserve graph")
	}
	if err := os.WriteFile(filepath.Join(api.root, "main.tf"), []byte(testSource), 0600); err != nil {
		t.Fatal(err)
	}
	if recovered := readEvent(); !recovered.Valid || recovered.Revision == invalid.Revision {
		t.Fatal("SSE did not recover after external repair")
	}
}

func TestStaticAppFallbackAndCacheHeaders(t *testing.T) {
	api := setupAPI(t)
	for _, path := range []string{"/", "/workspace"} {
		assertStatus(t, api.request(t, "GET", path, "", nil), http.StatusOK)
	}
	assertStatus(t, api.request(t, "GET", "/missing.js", "", nil), http.StatusNotFound)
	response := api.request(t, "GET", "/assets/main-abc123.js", "", nil)
	defer response.Body.Close()
	if !strings.Contains(response.Header.Get("Cache-Control"), "immutable") {
		t.Fatal("fingerprinted assets should have immutable caching")
	}
	missing, err := New(api.app.workspace, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	responseRecorder := httptest.NewRecorder()
	missing.static(responseRecorder, httptest.NewRequest("GET", "http://127.0.0.1/", nil))
	if responseRecorder.Code != http.StatusServiceUnavailable {
		t.Fatal("missing build should produce a useful error")
	}
}

func TestHTTPRejectsSymlinkFilesMissingProjectAndOversizedContent(t *testing.T) {
	api := setupAPI(t)
	initial := projectFrom(t, api.request(t, "POST", "/api/open", `{"path":"."}`, nil))
	missingProject := bodyJSON(t, map[string]string{"path": "main.tf", "content": testSource, "expectedRevision": initial.Files[0].Revision})
	assertStatus(t, api.request(t, "PUT", "/api/files", missingProject, nil), http.StatusConflict)
	oversized := bodyJSON(t, map[string]string{"projectId": initial.ID, "path": "main.tf", "content": strings.Repeat("x", workspace.MaxFileBytes+1), "expectedRevision": initial.Files[0].Revision})
	assertStatus(t, api.request(t, "PUT", "/api/files", oversized, nil), http.StatusRequestEntityTooLarge)
	outside := filepath.Join(t.TempDir(), "external.tf")
	if err := os.WriteFile(outside, []byte(testSource), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(api.root, "linked.tf")); err != nil {
		t.Fatal(err)
	}
	assertStatus(t, api.request(t, "POST", "/api/open", `{"path":"."}`, nil), http.StatusForbidden)
}
