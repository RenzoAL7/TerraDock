package terraform

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

func editableProperty(property string) bool {
	switch property {
	case "cidr_block", "instance_type", "availability_zone", "description", "enable_dns_support", "enable_dns_hostnames", "multi_az", "allocated_storage":
		return true
	default:
		return false
	}
}

// EditLiteral replaces exactly one existing literal expression, preserving every
// byte outside its HCL source range. It never rewrites an entire resource/file.
// The caller is responsible for revision checks and atomic persistence.
func EditLiteral(content, filename, resourceID, property string, value any) (string, error) {
	if !editableProperty(property) {
		return "", fmt.Errorf("la propiedad %q no admite edición visual", property)
	}
	parsed, diagnostics := hclsyntax.ParseConfig([]byte(content), filename, hcl.InitialPos)
	if diagnostics.HasErrors() || parsed == nil {
		return "", errors.New("corrige los errores HCL del archivo antes de editar una propiedad")
	}
	body := parsed.Body.(*hclsyntax.Body)
	var target *hclsyntax.Block
	for _, block := range body.Blocks {
		id, _, _, ok := blockIdentity(block)
		if !ok || id != resourceID || block.Type != "resource" {
			continue
		}
		if target != nil {
			return "", errors.New("el recurso tiene declaraciones duplicadas")
		}
		target = block
	}
	if target == nil {
		return "", fmt.Errorf("no se encontró el recurso %q en %s", resourceID, filename)
	}
	attr := target.Body.Attributes[property]
	if attr == nil {
		return "", fmt.Errorf("la propiedad %q no existe en el recurso", property)
	}
	current, literal := literalValue(attr.Expr)
	if !literal {
		return "", errors.New("esta propiedad contiene una expresión; edítala en el código")
	}
	replacement, err := encodeLiteral(value, current)
	if err != nil {
		return "", err
	}
	r := attr.Expr.Range()
	if r.Start.Byte < 0 || r.End.Byte > len(content) || r.End.Byte < r.Start.Byte {
		return "", errors.New("el rango de la expresión no es válido")
	}
	updated := content[:r.Start.Byte] + replacement + content[r.End.Byte:]
	_, diagnostics = hclsyntax.ParseConfig([]byte(updated), filename, hcl.InitialPos)
	if diagnostics.HasErrors() {
		return "", errors.New("la modificación produciría HCL inválido")
	}
	return updated, nil
}

func encodeLiteral(value, current any) (string, error) {
	switch current.(type) {
	case string:
		text, ok := value.(string)
		if !ok {
			return "", errors.New("se requiere un valor de texto")
		}
		// Generate only this expression's tokens: HCL string escaping handles
		// template introducers and control characters (which differ from JSON).
		return string(hclwrite.TokensForValue(cty.StringVal(text)).Bytes()), nil
	case bool:
		boolean, ok := value.(bool)
		if !ok {
			return "", errors.New("se requiere un valor booleano")
		}
		return strconv.FormatBool(boolean), nil
	case float64:
		var encoded string
		switch v := value.(type) {
		case float64:
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return "", errors.New("se requiere un número finito")
			}
			encoded = strconv.FormatFloat(v, 'g', -1, 64)
		case float32:
			if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
				return "", errors.New("se requiere un número finito")
			}
			encoded = strconv.FormatFloat(float64(v), 'g', -1, 32)
		case int:
			encoded = strconv.Itoa(v)
		case int64:
			encoded = strconv.FormatInt(v, 10)
		case json.Number:
			encoded = string(v)
			if !json.Valid([]byte(encoded)) {
				return "", errors.New("se requiere un número finito")
			}
		default:
			return "", errors.New("se requiere un valor numérico")
		}
		number, err := cty.ParseNumberVal(encoded)
		if err != nil {
			return "", errors.New("se requiere un número finito")
		}
		if _, safe := browserNumber(number); !safe {
			return "", errors.New("el número excede la precisión de la edición visual; edítalo en el código")
		}
		return encoded, nil
	default:
		return "", errors.New("tipo de literal no compatible")
	}
}
