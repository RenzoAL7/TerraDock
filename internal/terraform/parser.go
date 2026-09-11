package terraform

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

type declaration struct {
	resource Resource
	block    *hclsyntax.Block
	source   []byte
}

// Parse analyzes the supplied files as one root module. Callers must select the
// module directory; subdirectories must not be flattened into the same input.
func Parse(files map[string]string) Analysis {
	a := Analysis{
		Resources: []Resource{}, Edges: []Edge{}, Diagnostics: []Diagnostic{},
		Findings: []Finding{}, Valid: true,
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	decls := make([]declaration, 0)
	byID := map[string]int{}
	for _, name := range names {
		if strings.HasSuffix(name, ".tf.json") {
			a.Diagnostics = append(a.Diagnostics, Diagnostic{"warning", "Los archivos .tf.json no se interpretan en esta versión.", name, 1})
			continue
		}
		if !strings.HasSuffix(name, ".tf") {
			continue
		}
		source := []byte(files[name])
		parsed, diagnostics := hclsyntax.ParseConfig(source, name, hcl.InitialPos)
		for _, d := range diagnostics {
			severity := "warning"
			if d.Severity == hcl.DiagError {
				severity = "error"
				a.Valid = false
			}
			line := 1
			if d.Subject != nil {
				line = d.Subject.Start.Line
			}
			a.Diagnostics = append(a.Diagnostics, Diagnostic{severity, d.Summary + ": " + d.Detail, name, line})
		}
		if parsed == nil {
			continue
		}
		body, ok := parsed.Body.(*hclsyntax.Body)
		if !ok {
			continue
		}
		for _, block := range body.Blocks {
			id, resourceType, resourceName, supported := blockIdentity(block)
			if !supported {
				if block.Type == "resource" || block.Type == "data" || block.Type == "module" {
					a.Valid = false
					a.Diagnostics = append(a.Diagnostics, Diagnostic{"error", "La declaración " + block.Type + " no tiene las etiquetas requeridas.", name, block.TypeRange.Start.Line})
				}
				continue
			}
			if previous, exists := byID[id]; exists {
				a.Valid = false
				a.Diagnostics = append(a.Diagnostics, Diagnostic{"error", fmt.Sprintf("Declaración duplicada %s; también existe en %s:%d.", id, decls[previous].resource.File, decls[previous].resource.Line), name, block.TypeRange.Start.Line})
				continue
			}
			resource := Resource{
				ID: id, Type: resourceType, Name: resourceName, File: name,
				Line: block.TypeRange.Start.Line, Category: category(resourceType),
				Label: resourceLabel(block, resourceName), Properties: []Property{}, DependsOn: []string{},
			}
			for _, attr := range orderedAttributes(block.Body) {
				value, literal := literalValue(attr.Expr)
				kind := "expression"
				if literal {
					kind = "literal"
				}
				resource.Properties = append(resource.Properties, Property{
					Name: attr.Name, Expression: sourceRange(source, attr.Expr.Range()),
					Value: value, Kind: kind,
					Editable: literal && block.Type == "resource" && editableProperty(attr.Name),
					Line:     attr.NameRange.Start.Line,
				})
				if attr.Name == "count" || attr.Name == "for_each" {
					a.Diagnostics = append(a.Diagnostics, Diagnostic{"warning", fmt.Sprintf("%s usa %s: se muestra un bloque declarado, sin expandir sus instancias.", id, attr.Name), name, attr.NameRange.Start.Line})
				}
			}
			// Nested blocks remain inspectable as original HCL and read-only.
			for _, nested := range block.Body.Blocks {
				resource.Properties = append(resource.Properties, Property{
					Name: nested.Type, Expression: sourceRange(source, nested.Range()), Kind: "expression",
					Line: nested.TypeRange.Start.Line,
				})
			}
			if block.Type == "module" {
				a.Diagnostics = append(a.Diagnostics, Diagnostic{"warning", fmt.Sprintf("El módulo %s se muestra sin expandir su código interno.", resourceName), name, resource.Line})
			}
			for _, parentAttr := range []string{"subnet_id", "vpc_id"} {
				attr := block.Body.Attributes[parentAttr]
				if attr == nil {
					continue
				}
				if traversal, direct := attr.Expr.(*hclsyntax.ScopeTraversalExpr); direct {
					if parentID := referenceID(traversal.Traversal); parentID != "" {
						resource.ParentID = parentID
						break
					}
				}
			}
			byID[id] = len(decls)
			decls = append(decls, declaration{resource, block, source})
		}
	}
	edgeKeys := map[string]bool{}
	for i := range decls {
		d := &decls[i]
		if d.resource.ParentID != "" {
			parent, exists := byID[d.resource.ParentID]
			// Only managed resources can be layout containers. A VPC cannot be
			// nested, and a subnet can only be nested in a VPC, making cycles
			// impossible even when the source configuration is invalid.
			if !exists || d.block.Type != "resource" || d.resource.Type == "aws_vpc" ||
				decls[parent].block.Type != "resource" ||
				(decls[parent].resource.Type != "aws_vpc" && decls[parent].resource.Type != "aws_subnet") ||
				(d.resource.Type == "aws_subnet" && decls[parent].resource.Type != "aws_vpc") {
				d.resource.ParentID = ""
			}
		}
		seenDepends := map[string]bool{}
		seenUnresolved := map[string]bool{}
		walkAttributes(d.block.Body, func(attr *hclsyntax.Attribute) {
			kind := "reference"
			if attr.Name == "depends_on" {
				kind = "dependency"
			}
			for _, traversal := range attr.Expr.Variables() {
				ref := referenceID(traversal)
				if ref == "" || ref == d.resource.ID {
					continue
				}
				if !seenDepends[ref] {
					d.resource.DependsOn = append(d.resource.DependsOn, ref)
					seenDepends[ref] = true
				}
				if _, exists := byID[ref]; !exists {
					if !seenUnresolved[ref] {
						a.Diagnostics = append(a.Diagnostics, Diagnostic{"warning", fmt.Sprintf("%s referencia %s, que no se encontró en este módulo.", d.resource.ID, ref), d.resource.File, attr.NameRange.Start.Line})
						seenUnresolved[ref] = true
					}
					continue
				}
				key := ref + "→" + d.resource.ID + ":" + kind
				if edgeKeys[key] {
					continue
				}
				edgeKeys[key] = true
				a.Edges = append(a.Edges, Edge{key, ref, d.resource.ID, kind, attr.Name})
			}
		})
		sort.Strings(d.resource.DependsOn)
		a.Resources = append(a.Resources, d.resource)
	}
	a.Findings = findIssues(decls, byID)
	return a
}

func blockIdentity(block *hclsyntax.Block) (id, resourceType, name string, ok bool) {
	switch {
	case block.Type == "resource" && len(block.Labels) == 2:
		return block.Labels[0] + "." + block.Labels[1], block.Labels[0], block.Labels[1], true
	case block.Type == "data" && len(block.Labels) == 2:
		return "data." + block.Labels[0] + "." + block.Labels[1], block.Labels[0], block.Labels[1], true
	case block.Type == "module" && len(block.Labels) == 1:
		return "module." + block.Labels[0], "module", block.Labels[0], true
	default:
		return "", "", "", false
	}
}

func orderedAttributes(body *hclsyntax.Body) []*hclsyntax.Attribute {
	attrs := make([]*hclsyntax.Attribute, 0, len(body.Attributes))
	for _, attr := range body.Attributes {
		attrs = append(attrs, attr)
	}
	sort.Slice(attrs, func(i, j int) bool { return attrs[i].NameRange.Start.Byte < attrs[j].NameRange.Start.Byte })
	return attrs
}

func walkAttributes(body *hclsyntax.Body, visit func(*hclsyntax.Attribute)) {
	for _, attr := range orderedAttributes(body) {
		visit(attr)
	}
	for _, block := range body.Blocks {
		walkAttributes(block.Body, visit)
	}
}

// literalValue deliberately checks syntax before evaluation, so constant-looking
// function calls, interpolations, and computed expressions remain read-only.
func literalValue(expr hclsyntax.Expression) (any, bool) {
	switch value := expr.(type) {
	case *hclsyntax.LiteralValueExpr:
		if value.Val.IsNull() || !value.Val.IsKnown() {
			return nil, false
		}
		if value.Val.Type() == cty.Bool {
			return value.Val.True(), true
		}
		if value.Val.Type() == cty.Number {
			return browserNumber(value.Val)
		}
	case *hclsyntax.TemplateExpr:
		if !value.IsStringLiteral() {
			return nil, false
		}
		result, diagnostics := value.Value(nil)
		if !diagnostics.HasErrors() && result.IsKnown() && !result.IsNull() && result.Type() == cty.String {
			return result.AsString(), true
		}
	case *hclsyntax.UnaryOpExpr:
		if value.Op == hclsyntax.OpNegate {
			if operand, ok := value.Val.(*hclsyntax.LiteralValueExpr); ok && operand.Val.Type() == cty.Number {
				result, diagnostics := value.Value(nil)
				if !diagnostics.HasErrors() {
					return browserNumber(result)
				}
			}
		}
	}
	return nil, false
}

// The client uses JavaScript numbers. Only expose numeric literals when their
// decimal value survives that round trip, so opening/saving the inspector can
// never silently round a large integer or a high-precision decimal. The original
// expression remains available for every other number in the code editor.
func browserNumber(value cty.Value) (any, bool) {
	number, _ := value.AsBigFloat().Float64()
	if math.IsInf(number, 0) || math.IsNaN(number) || math.Abs(number) > 9007199254740991 {
		return nil, false
	}
	roundTrip, err := cty.ParseNumberVal(strconv.FormatFloat(number, 'g', -1, 64))
	if err != nil || !roundTrip.RawEquals(value) {
		return nil, false
	}
	return number, true
}

func sourceRange(source []byte, r hcl.Range) string {
	if r.Start.Byte < 0 || r.End.Byte < r.Start.Byte || r.End.Byte > len(source) {
		return ""
	}
	return string(source[r.Start.Byte:r.End.Byte])
}

func referenceID(traversal hcl.Traversal) string {
	if len(traversal) < 2 {
		return ""
	}
	root, ok := traversal[0].(hcl.TraverseRoot)
	if !ok {
		return ""
	}
	name, ok := traversal[1].(hcl.TraverseAttr)
	if !ok {
		return ""
	}
	switch root.Name {
	case "var", "local", "path", "terraform", "each", "count", "self":
		return ""
	case "data":
		if len(traversal) > 2 {
			if dataName, ok := traversal[2].(hcl.TraverseAttr); ok {
				return "data." + name.Name + "." + dataName.Name
			}
		}
		return ""
	default:
		return root.Name + "." + name.Name
	}
}

func resourceLabel(block *hclsyntax.Block, fallback string) string {
	if tags := block.Body.Attributes["tags"]; tags != nil {
		if object, ok := tags.Expr.(*hclsyntax.ObjectConsExpr); ok {
			for _, item := range object.Items {
				key, diagnostics := item.KeyExpr.Value(nil)
				if diagnostics.HasErrors() || !key.IsKnown() || key.IsNull() || key.Type() != cty.String || key.AsString() != "Name" {
					continue
				}
				if label, ok := literalValue(item.ValueExpr); ok {
					if text, ok := label.(string); ok && text != "" {
						return text
					}
				}
			}
		}
	}
	if attr := block.Body.Attributes["name"]; attr != nil {
		if label, ok := literalValue(attr.Expr); ok {
			if text, ok := label.(string); ok && text != "" {
				return text
			}
		}
	}
	return fallback
}

func category(resourceType string) string {
	switch {
	case strings.HasPrefix(resourceType, "aws_security_group"), strings.HasPrefix(resourceType, "aws_vpc_security_group"), strings.HasPrefix(resourceType, "aws_iam_"):
		return "security"
	case strings.HasPrefix(resourceType, "aws_lb"), strings.HasPrefix(resourceType, "aws_alb"), resourceType == "aws_elb":
		return "loadbalancer"
	case strings.HasPrefix(resourceType, "aws_db_"), strings.HasPrefix(resourceType, "aws_rds_"):
		return "database"
	case strings.HasPrefix(resourceType, "aws_s3_"), strings.HasPrefix(resourceType, "aws_ebs_"), strings.HasPrefix(resourceType, "aws_efs_"):
		return "storage"
	case strings.HasPrefix(resourceType, "aws_instance"), strings.HasPrefix(resourceType, "aws_launch_"), strings.HasPrefix(resourceType, "aws_autoscaling_"), strings.HasPrefix(resourceType, "aws_lambda_"):
		return "compute"
	case strings.HasPrefix(resourceType, "aws_vpc"), strings.HasPrefix(resourceType, "aws_subnet"), strings.HasPrefix(resourceType, "aws_route"), strings.HasPrefix(resourceType, "aws_internet_gateway"), strings.HasPrefix(resourceType, "aws_nat_gateway"), strings.HasPrefix(resourceType, "aws_eip"):
		return "network"
	default:
		return "other"
	}
}
