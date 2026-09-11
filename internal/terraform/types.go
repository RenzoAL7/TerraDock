// Package terraform provides a deliberately bounded, static view of Terraform
// configuration. It does not evaluate providers, variables, modules, or plans.
package terraform

// SourceFile is the editor representation of a file and its content revision.
type SourceFile struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Revision string `json:"revision"`
}

// Property retains the original expression even when its literal value is known.
type Property struct {
	Name       string `json:"name"`
	Expression string `json:"expression"`
	Value      any    `json:"value,omitempty"`
	Kind       string `json:"kind"`
	Editable   bool   `json:"editable"`
	Line       int    `json:"line"`
}

// Resource represents a declaration, not a deployed instance.
type Resource struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	Name       string     `json:"name"`
	File       string     `json:"file"`
	Line       int        `json:"line"`
	Category   string     `json:"category"`
	Label      string     `json:"label"`
	Properties []Property `json:"properties"`
	DependsOn  []string   `json:"dependsOn"`
	ParentID   string     `json:"parentId,omitempty"`
}

// Edge points from the referenced declaration to its dependent declaration.
type Edge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
	Label  string `json:"label"`
}

type Diagnostic struct {
	Severity string `json:"severity"`
	Message  string `json:"message"`
	File     string `json:"file"`
	Line     int    `json:"line"`
}

type Finding struct {
	ID         string `json:"id"`
	Severity   string `json:"severity"`
	ResourceID string `json:"resourceId"`
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	File       string `json:"file"`
	Line       int    `json:"line"`
}

// Valid means the input has no HCL/declaration errors; it is not the result of
// terraform validate, an AWS configuration check, or a deployment guarantee.
type Analysis struct {
	Resources   []Resource   `json:"resources"`
	Edges       []Edge       `json:"edges"`
	Diagnostics []Diagnostic `json:"diagnostics"`
	Findings    []Finding    `json:"findings"`
	Valid       bool         `json:"valid"`
}
