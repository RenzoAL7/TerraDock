package examples_test

import (
	"testing"

	"github.com/RenzoAL7/TerraDock/examples"
	"github.com/RenzoAL7/TerraDock/internal/terraform"
)

func TestBundledExamplesAndIndependentCopies(t *testing.T) {
	for _, tt := range []struct {
		name                string
		resources, findings int
	}{{"basic-vpc", 3, 0}, {"web-app", 15, 1}} {
		t.Run(tt.name, func(t *testing.T) {
			files, err := examples.Load(tt.name)
			if err != nil {
				t.Fatal(err)
			}
			a := terraform.Parse(files)
			if !a.Valid || len(a.Resources) != tt.resources || len(a.Findings) != tt.findings || len(a.Diagnostics) != 0 {
				t.Fatalf("example contract mismatch: %#v", a)
			}
			for name := range files {
				files[name] = "changed"
			}
			fresh, err := examples.Load(tt.name)
			if err != nil || !terraform.Parse(fresh).Valid || len(terraform.Parse(fresh).Resources) != tt.resources {
				t.Fatal("mutating a loaded example modified the embedded source")
			}
		})
	}
	if _, err := examples.Load("../basic-vpc"); err == nil {
		t.Fatal("unknown example path accepted")
	}
}
