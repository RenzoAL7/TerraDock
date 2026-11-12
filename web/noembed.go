//go:build !embed

// Package web carries the built frontend inside release binaries. Without the
// embed build tag the frontend is read from disk (--assets).
package web

import "io/fs"

// Files is the built frontend, or nil when the binary was built without it.
var Files fs.FS
