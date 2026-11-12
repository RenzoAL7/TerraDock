//go:build embed

// Package web carries the built frontend inside release binaries. Build it
// with `npm --prefix web run build` before `go build -tags embed`.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Files is the built frontend, or nil when the binary was built without it.
var Files fs.FS = mustSub(dist, "dist")

func mustSub(fsys fs.FS, dir string) fs.FS {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic(err)
	}
	return sub
}
