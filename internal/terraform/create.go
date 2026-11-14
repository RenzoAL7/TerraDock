package terraform

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

// NewAttribute is one argument of a block created from the diagram. Exactly
// one of Value (a string, number or boolean literal) or Expression (a single
// HCL expression, such as a reference) is set.
type NewAttribute struct {
	Name       string `json:"name"`
	Value      any    `json:"value,omitempty"`
	Expression string `json:"expression,omitempty"`
}

// NewResource describes a managed resource block to add to a file.
type NewResource struct {
	Type       string         `json:"type"`
	Name       string         `json:"name"`
	Attributes []NewAttribute `json:"attributes"`
}

const (
	maxIdentifier     = 64
	maxNewAttributes  = 32
	maxNewExpression  = 4096
	newBlockMaxLength = 64 * 1024
)

// ValidName reports whether s is an identifier TerraDock accepts for a new
// resource type, name or argument: an HCL identifier restricted to ASCII
// letters, digits, "_" and "-", starting with a letter or "_".
func ValidName(s string) bool {
	if s == "" || len(s) > maxIdentifier {
		return false
	}
	for i, r := range s {
		letter := r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		if i == 0 && !letter {
			return false
		}
		if !letter && r != '-' && (r < '0' || r > '9') {
			return false
		}
	}
	return hclsyntax.ValidIdentifier(s)
}

// InsertResource appends a resource block to files[filename] and returns the
// new content and the line where the block starts. Every existing byte is kept
// as a prefix of the result; only a line break separator and the block are
// added. files holds the whole module (with filename's current text) so a
// resource declared in another file is rejected as a duplicate. The caller is
// responsible for revision checks and persistence.
func InsertResource(files map[string]string, filename string, spec NewResource) (string, int, error) {
	if !ValidName(spec.Type) {
		return "", 0, errors.New("el tipo debe ser un identificador HCL: letras, dígitos, _ o -, empezando por una letra o _")
	}
	if !ValidName(spec.Name) {
		return "", 0, errors.New("el nombre debe ser un identificador HCL: letras, dígitos, _ o -, empezando por una letra o _")
	}
	if !strings.HasSuffix(filename, ".tf") {
		return "", 0, errors.New("solo se pueden crear recursos en archivos .tf")
	}
	content, ok := files[filename]
	if !ok {
		return "", 0, fmt.Errorf("el archivo %s no pertenece al proyecto", filename)
	}
	parsed, diagnostics := hclsyntax.ParseConfig([]byte(content), filename, hcl.InitialPos)
	if diagnostics.HasErrors() || parsed == nil {
		return "", 0, errors.New("corrige los errores HCL del archivo antes de crear un recurso")
	}
	id := spec.Type + "." + spec.Name
	if where := declaredIn(files, spec.Type, spec.Name); where != "" {
		return "", 0, fmt.Errorf("ya existe %s en %s", id, where)
	}
	block, err := resourceBlock(spec)
	if err != nil {
		return "", 0, err
	}
	newline := "\n"
	if strings.Contains(content, "\r\n") {
		newline = "\r\n"
		block = strings.ReplaceAll(block, "\n", "\r\n")
	}
	separator := ""
	switch {
	case content == "" || strings.HasSuffix(content, newline+newline):
	case strings.HasSuffix(content, "\n"):
		separator = newline
	default:
		separator = newline + newline
	}
	prefix := content + separator
	updated := prefix + block
	line := strings.Count(prefix, "\n") + 1
	// The block was generated from validated parts; parsing the result proves
	// it, and that it adds exactly the requested resource and nothing else.
	result, diagnostics := hclsyntax.ParseConfig([]byte(updated), filename, hcl.InitialPos)
	if diagnostics.HasErrors() || result == nil {
		return "", 0, errors.New("el recurso produciría HCL inválido")
	}
	body := result.Body.(*hclsyntax.Body)
	before := parsed.Body.(*hclsyntax.Body)
	if len(body.Blocks) != len(before.Blocks)+1 || len(body.Attributes) != len(before.Attributes) {
		return "", 0, errors.New("el recurso produciría HCL inesperado")
	}
	added := body.Blocks[len(body.Blocks)-1]
	if added.Type != "resource" || len(added.Labels) != 2 || added.Labels[0] != spec.Type || added.Labels[1] != spec.Name ||
		len(added.Body.Blocks) != 0 || len(added.Body.Attributes) != len(spec.Attributes) || added.TypeRange.Start.Line != line {
		return "", 0, errors.New("el recurso produciría HCL inesperado")
	}
	return updated, line, nil
}

// declaredIn returns "file:line" of an existing resource with the same type
// and name in any .tf file, or "". Files with syntax errors are still checked
// as far as they parse.
func declaredIn(files map[string]string, resourceType, name string) string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, file := range names {
		// Labels are compared once parsed: "m\u0061in" declares "main".
		if !strings.HasSuffix(file, ".tf") {
			continue
		}
		parsed, _ := hclsyntax.ParseConfig([]byte(files[file]), file, hcl.InitialPos)
		if parsed == nil {
			continue
		}
		body, ok := parsed.Body.(*hclsyntax.Body)
		if !ok {
			continue
		}
		for _, block := range body.Blocks {
			if block.Type == "resource" && len(block.Labels) == 2 && block.Labels[0] == resourceType && block.Labels[1] == name {
				return fmt.Sprintf("%s:%d", file, block.TypeRange.Start.Line)
			}
		}
	}
	return ""
}

func resourceBlock(spec NewResource) (string, error) {
	if len(spec.Attributes) > maxNewAttributes {
		return "", fmt.Errorf("un recurso nuevo admite hasta %d atributos", maxNewAttributes)
	}
	file := hclwrite.NewEmptyFile()
	body := file.Body().AppendNewBlock("resource", []string{spec.Type, spec.Name}).Body()
	seen := map[string]bool{}
	for _, attr := range spec.Attributes {
		if !ValidName(attr.Name) {
			return "", fmt.Errorf("el atributo %q no es un identificador HCL válido", attr.Name)
		}
		if seen[attr.Name] {
			return "", fmt.Errorf("el atributo %s está repetido", attr.Name)
		}
		seen[attr.Name] = true
		tokens, err := attributeTokens(attr)
		if err != nil {
			return "", fmt.Errorf("%s: %w", attr.Name, err)
		}
		body.SetAttributeRaw(attr.Name, tokens)
	}
	formatted := string(hclwrite.Format(file.Bytes()))
	if len(formatted) > newBlockMaxLength {
		return "", errors.New("el recurso nuevo es demasiado grande")
	}
	return formatted, nil
}

func attributeTokens(attr NewAttribute) (hclwrite.Tokens, error) {
	if attr.Expression != "" {
		if attr.Value != nil {
			return nil, errors.New("indica un valor o una expresión, no ambos")
		}
		return expressionTokens(attr.Expression)
	}
	switch v := attr.Value.(type) {
	case string:
		return hclwrite.TokensForValue(cty.StringVal(v)), nil
	case bool:
		return hclwrite.TokensForValue(cty.BoolVal(v)), nil
	case json.Number:
		return numberTokens(string(v))
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, errors.New("se requiere un número finito")
		}
		return numberTokens(strconv.FormatFloat(v, 'g', -1, 64))
	case int:
		return numberTokens(strconv.Itoa(v))
	case nil:
		return nil, errors.New("falta el valor")
	default:
		return nil, errors.New("solo se admiten textos, números y booleanos")
	}
}

func numberTokens(text string) (hclwrite.Tokens, error) {
	number, err := cty.ParseNumberVal(text)
	if err != nil {
		return nil, errors.New("se requiere un número finito")
	}
	if _, safe := browserNumber(number); !safe {
		return nil, errors.New("el número excede la precisión de la edición visual")
	}
	return hclwrite.Tokens{{Type: hclsyntax.TokenNumberLit, Bytes: []byte(text)}}, nil
}

// expressionTokens accepts one complete HCL expression (a reference, a call
// such as jsonencode(...), a list…) and returns its tokens unchanged.
func expressionTokens(expression string) (hclwrite.Tokens, error) {
	if len(expression) > maxNewExpression {
		return nil, errors.New("la expresión es demasiado larga")
	}
	expr, diagnostics := hclsyntax.ParseExpression([]byte(expression), "expresión", hcl.InitialPos)
	if diagnostics.HasErrors() || expr == nil {
		return nil, errors.New("la expresión no es HCL válido")
	}
	if _, literal := expr.(*hclsyntax.LiteralValueExpr); literal && strings.TrimSpace(expression) == "null" {
		return nil, errors.New("falta el valor")
	}
	file, diagnostics := hclwrite.ParseConfig([]byte("value = "+expression+"\n"), "expresión", hcl.InitialPos)
	if diagnostics.HasErrors() {
		return nil, errors.New("la expresión no es HCL válido")
	}
	attr := file.Body().GetAttribute("value")
	if attr == nil || len(file.Body().Attributes()) != 1 || len(file.Body().Blocks()) != 0 {
		return nil, errors.New("la expresión no es HCL válido")
	}
	return attr.Expr().BuildTokens(nil), nil
}
