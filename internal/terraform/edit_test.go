package terraform

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestEditLiteralPreservesUnrelatedBytesAndEscapesTemplates(t *testing.T) {
	before := "# español, café y 日本語: conservar bytes\r\n" +
		"resource \"aws_instance\" \"web\" {\r\n" +
		"  instance_type  = \"t3.micro\" # comentario intacto\r\n" +
		"  description = \"inicial\"\r\n" +
		"  tags = { Name = \"${var.prefix}-web\" }\r\n" +
		"}\r\n\r\nresource \"aws_instance\" \"other\" { instance_type = \"t3.micro\" }\r\n"
	got, err := EditLiteral(before, "main.tf", "aws_instance.web", "instance_type", "t3.small")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(before, `"t3.micro"`, `"t3.small"`, 1)
	if got != want {
		t.Fatalf("edit changed unrelated bytes\nwant: %q\n got: %q", want, got)
	}
	text := "línea 1\n\"quoted\"\\directory\t\b\f${var.secret} %{if true} $${already} %%{escaped} <script>🌍"
	got, err = EditLiteral(before, "main.tf", "aws_instance.web", "description", text)
	if err != nil {
		t.Fatal(err)
	}
	a := Parse(map[string]string{"main.tf": got})
	p := propertyByName(t, resourceByID(t, a, "aws_instance.web"), "description")
	if !a.Valid || p.Value != text || !p.Editable {
		t.Fatalf("string became a template or lost characters: %#v", p)
	}
	start := strings.Index(before, `"inicial"`)
	end := start + len(`"inicial"`)
	if !strings.HasPrefix(got, before[:start]) || !strings.HasSuffix(got, before[end:]) {
		t.Fatal("description replacement changed unrelated bytes")
	}
}

func TestEditLiteralTypedValues(t *testing.T) {
	for _, tt := range []struct {
		name, property, old, want string
		value                     any
	}{
		{"boolean", "multi_az", "true", "false", false},
		{"zero", "allocated_storage", "20", "0", json.Number("0")},
		{"decimal", "allocated_storage", "20", "20.5", json.Number("20.5")},
		{"int64", "allocated_storage", "20", "24", int64(24)},
		{"float", "allocated_storage", "20", "24.5", 24.5},
		{"float32", "allocated_storage", "20", "0.1", float32(0.1)},
		{"negative", "allocated_storage", "20", "-1", -1},
	} {
		t.Run(tt.name, func(t *testing.T) {
			before := "resource \"aws_db_instance\" \"db\" {\n  " + tt.property + " = " + tt.old + "\n}\n"
			got, err := EditLiteral(before, "main.tf", "aws_db_instance.db", tt.property, tt.value)
			if err != nil {
				t.Fatal(err)
			}
			if want := strings.Replace(before, " = "+tt.old, " = "+tt.want, 1); got != want {
				t.Fatalf("want %q, got %q", want, got)
			}
			p := propertyByName(t, Parse(map[string]string{"main.tf": got}).Resources[0], tt.property)
			if !p.Editable {
				t.Fatalf("literal lost editability: %#v", p)
			}
		})
	}
}

func TestEditLiteralRejectsUnsupportedOrLossyChanges(t *testing.T) {
	for _, tt := range []struct {
		name, body, property string
		value                any
	}{
		{"wrong text type", `instance_type = "t3.micro"`, "instance_type", true},
		{"wrong bool type", `multi_az = false`, "multi_az", "true"},
		{"wrong number type", `allocated_storage = 20`, "allocated_storage", "20"},
		{"null", `allocated_storage = 20`, "allocated_storage", nil},
		{"array", `allocated_storage = 20`, "allocated_storage", []int{20}},
		{"variable", `instance_type = var.instance_type`, "instance_type", "t3.small"},
		{"interpolation", `instance_type = "${var.instance_type}"`, "instance_type", "t3.small"},
		{"function", `instance_type = lower("T3.MICRO")`, "instance_type", "t3.small"},
		{"protected property", `ami = "ami-123"`, "ami", "ami-456"},
		{"missing property", `ami = "ami-123"`, "instance_type", "t3.small"},
		{"invalid HCL", `instance_type =`, "instance_type", "t3.small"},
		{"large JSON integer", `allocated_storage = 20`, "allocated_storage", json.Number("9007199254740993")},
		{"large int64", `allocated_storage = 20`, "allocated_storage", int64(9007199254740993)},
		{"precise decimal", `allocated_storage = 20`, "allocated_storage", json.Number("0.123456789012345678901")},
		{"invalid JSON number", `allocated_storage = 20`, "allocated_storage", json.Number("1+2")},
		{"overflow", `allocated_storage = 20`, "allocated_storage", json.Number("1e9999")},
		{"nan", `allocated_storage = 20`, "allocated_storage", math.NaN()},
		{"infinity", `allocated_storage = 20`, "allocated_storage", math.Inf(1)},
		{"unsafe current", `allocated_storage = 9007199254740993`, "allocated_storage", 20},
	} {
		t.Run(tt.name, func(t *testing.T) {
			before := "resource \"aws_instance\" \"web\" {\n  " + tt.body + "\n}\n"
			got, err := EditLiteral(before, "main.tf", "aws_instance.web", tt.property, tt.value)
			if err == nil || got != "" {
				t.Fatalf("unsafe update accepted: %q, %v", got, err)
			}
		})
	}
}

func TestEditLiteralRejectsAmbiguousOrWrongDeclarations(t *testing.T) {
	for _, content := range []string{
		`resource "aws_instance" "web" { instance_type = "t3.micro" }
resource "aws_instance" "web" { instance_type = "t3.small" }`,
		`resource "aws_instance" "other" { instance_type = "t3.micro" }`,
		`data "aws_instance" "web" { instance_type = "t3.micro" }`,
	} {
		if got, err := EditLiteral(content, "main.tf", "aws_instance.web", "instance_type", "t3.large"); err == nil || got != "" {
			t.Fatalf("ambiguous edit accepted: %q, %v", got, err)
		}
	}
}

// Seed inputs exercise valid, malformed, Unicode, and truncated configurations.
// Regular go test executes the corpus; go test -fuzz can expand it separately.
func FuzzParseAndEditDoNotPanic(f *testing.F) {
	for _, seed := range []string{"", "resource", `resource "aws_instance" "web" { instance_type = "t3.micro" }`, "# 日本語\nresource \"aws_instance\" \"web\" {\n", string([]byte{0xff, 0, 0xfe})} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, content string) {
		if len(content) > 65536 {
			t.Skip()
		}
		Parse(map[string]string{"main.tf": content})
		updated, err := EditLiteral(content, "main.tf", "aws_instance.web", "instance_type", "t3.small")
		if err == nil && !Parse(map[string]string{"main.tf": updated}).Valid {
			t.Fatal("successful edit produced an invalid analysis")
		}
	})
}
