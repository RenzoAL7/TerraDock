// Package publicdemo exposes only in-memory parsing and literal editing to the
// browser. It does not import the server, workspace, filesystem or Terraform CLI.
package publicdemo

import (
	"encoding/json"
	"strings"

	"github.com/RenzoAL7/TerraDock/internal/terraform"
)

const MaxSourceBytes = 64 * 1024

type Request struct {
	Operation  string `json:"operation"`
	Content    string `json:"content"`
	ResourceID string `json:"resourceId,omitempty"`
	Property   string `json:"property,omitempty"`
	Value      any    `json:"value,omitempty"`
}

type Response struct {
	Content  string              `json:"content"`
	Analysis *terraform.Analysis `json:"analysis,omitempty"`
	Error    string              `json:"error,omitempty"`
}

// Handle shares the local app's parser and editor, with a bounded single-file
// contract. Invalid HCL is returned as diagnostics, never a successful graph.
func Handle(request Request) Response {
	if len(request.Content) > MaxSourceBytes || strings.Count(request.Content, "\n") > 1000 {
		return Response{Error: "La demo admite hasta 64 KiB y 1000 líneas en main.tf."}
	}
	content := request.Content
	switch request.Operation {
	case "parse":
	case "edit":
		if !terraform.Parse(map[string]string{"main.tf": content}).Valid {
			return Response{Error: "Corrige el HCL antes de editar las propiedades."}
		}
		var err error
		content, err = terraform.EditLiteral(content, "main.tf", request.ResourceID, request.Property, request.Value)
		if err != nil {
			return Response{Error: err.Error()}
		}
		if len(content) > MaxSourceBytes {
			return Response{Error: "El cambio supera el límite de 64 KiB de la demo."}
		}
	default:
		return Response{Error: "Operación no disponible en esta demo."}
	}
	analysis := terraform.Parse(map[string]string{"main.tf": content})
	if len(analysis.Resources) > 60 {
		return Response{Error: "La demo admite hasta 60 declaraciones. Reduce el ejemplo para continuar."}
	}
	return Response{Content: content, Analysis: &analysis}
}

func HandleJSON(input string) (output string) {
	defer func() {
		if recover() != nil {
			output = `{"error":"No se pudo interpretar este fragmento. Reduce el ejemplo y vuelve a intentarlo."}`
		}
	}()
	var request Request
	if len(input) > 1024*1024 || json.Unmarshal([]byte(input), &request) != nil {
		return `{"error":"La solicitud de la demo no es válida."}`
	}
	encoded, err := json.Marshal(Handle(request))
	if err != nil {
		return `{"error":"No se pudo representar el resultado del análisis."}`
	}
	return string(encoded)
}
