// Package examples embeds illustrative projects for TerraDock's local demo.
// They are parser/editor fixtures and are not deployment-ready templates.
package examples

import (
	"embed"
	"fmt"
	"io/fs"
	"strings"
)

//go:embed basic-vpc/*.tf web-app/*.tf
var projects embed.FS

// Load returns an independent in-memory copy of one bundled demo project.
func Load(name string) (map[string]string, error) {
	if name != "basic-vpc" && name != "web-app" {
		return nil, fmt.Errorf("ejemplo desconocido: %s", name)
	}
	entries, err := fs.ReadDir(projects, name)
	if err != nil {
		return nil, err
	}
	files := make(map[string]string)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".tf") {
			continue
		}
		content, err := projects.ReadFile(name + "/" + entry.Name())
		if err != nil {
			return nil, err
		}
		files[entry.Name()] = string(content)
	}
	return files, nil
}
