package terraform

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func subnetSpec() NewResource {
	return NewResource{Type: "aws_subnet", Name: "app", Attributes: []NewAttribute{
		{Name: "vpc_id", Expression: "aws_vpc.main.id"},
		{Name: "cidr_block", Value: "10.0.1.0/24"},
		{Name: "map_public_ip_on_launch", Value: false},
		{Name: "count", Value: json.Number("1")},
	}}
}

func TestInsertResourceAppendsAndKeepsEveryByte(t *testing.T) {
	before := "# café, 日本語 y comentarios intactos\n" +
		"resource \"aws_vpc\" \"main\" {\n  cidr_block = \"10.0.0.0/16\" # nota\n}\n"
	files := map[string]string{"main.tf": before, "other.tf": `resource "aws_instance" "web" { ami = "x" }`}
	got, line, err := InsertResource(files, "main.tf", subnetSpec())
	if err != nil {
		t.Fatal(err)
	}
	want := before + "\n" + "resource \"aws_subnet\" \"app\" {\n" +
		"  vpc_id                  = aws_vpc.main.id\n" +
		"  cidr_block              = \"10.0.1.0/24\"\n" +
		"  map_public_ip_on_launch = false\n" +
		"  count                   = 1\n" +
		"}\n"
	if got != want {
		t.Fatalf("unexpected content\nwant: %q\n got: %q", want, got)
	}
	if line != 6 {
		t.Fatalf("block starts at line 6, got %d", line)
	}
	files["main.tf"] = got
	a := Parse(files)
	r := resourceByID(t, a, "aws_subnet.app")
	if !a.Valid || r.File != "main.tf" || r.Line != line || r.ParentID != "aws_vpc.main" {
		t.Fatalf("created resource is not part of the analysis: %#v", r)
	}
	if p := propertyByName(t, r, "cidr_block"); !p.Editable || p.Value != "10.0.1.0/24" {
		t.Fatalf("literal is not editable from the inspector: %#v", p)
	}
}

func TestInsertResourceSeparatorsAndLineEndings(t *testing.T) {
	block := "resource \"aws_s3_bucket\" \"logs\" {\n}\n"
	for _, tt := range []struct{ name, before, want string }{
		{"empty file", "", block},
		{"no trailing newline", "# a", "# a\n\n" + block},
		{"trailing newline", "# a\n", "# a\n\n" + block},
		{"blank line already", "# a\n\n", "# a\n\n" + block},
		{"windows", "# a\r\n", "# a\r\n\r\n" + strings.ReplaceAll(block, "\n", "\r\n")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, _, err := InsertResource(map[string]string{"main.tf": tt.before}, "main.tf", NewResource{Type: "aws_s3_bucket", Name: "logs"})
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("want %q, got %q", tt.want, got)
			}
		})
	}
}

func TestInsertResourceEscapesTextLiterals(t *testing.T) {
	text := "línea\n\"comillas\" ${var.secret} %{if true} <script>"
	got, _, err := InsertResource(map[string]string{"main.tf": ""}, "main.tf", NewResource{Type: "aws_security_group", Name: "web", Attributes: []NewAttribute{{Name: "description", Value: text}}})
	if err != nil {
		t.Fatal(err)
	}
	a := Parse(map[string]string{"main.tf": got})
	if p := propertyByName(t, resourceByID(t, a, "aws_security_group.web"), "description"); p.Value != text {
		t.Fatalf("text became a template or lost characters: %#v", p)
	}
}

func TestInsertResourceRejectsDuplicates(t *testing.T) {
	files := map[string]string{
		"main.tf":    "resource \"aws_vpc\" \"main\" {}\n",
		"network.tf": "\n\nresource \"aws_subnet\" \"app\" {}\n",
		"data.tf":    "data \"aws_subnet\" \"db\" {}\n",
		"escaped.tf": "resource \"aws_s3_bucket\" \"l\\u006fgs\" {}\n",
	}
	for _, tt := range []struct{ name, kind, where string }{
		{"same file", "aws_vpc.main", "main.tf:1"},
		{"another file", "aws_subnet.app", "network.tf:3"},
		{"escaped label", "aws_s3_bucket.logs", "escaped.tf:1"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			parts := strings.SplitN(tt.kind, ".", 2)
			got, _, err := InsertResource(files, "main.tf", NewResource{Type: parts[0], Name: parts[1]})
			if err == nil || got != "" || !strings.Contains(err.Error(), tt.where) {
				t.Fatalf("duplicate accepted or not located: %q, %v", got, err)
			}
		})
	}
	// A data source with the same type and name is a different address.
	if _, _, err := InsertResource(files, "main.tf", NewResource{Type: "aws_subnet", Name: "db"}); err != nil {
		t.Fatalf("data source treated as duplicate: %v", err)
	}
}

func expression(text string) func(*NewResource) {
	return func(s *NewResource) { s.Attributes[0] = NewAttribute{Name: s.Attributes[0].Name, Expression: text} }
}

func TestInsertResourceRejectsInvalidInput(t *testing.T) {
	valid := func(change func(*NewResource)) NewResource {
		spec := NewResource{Type: "aws_instance", Name: "web", Attributes: []NewAttribute{{Name: "instance_type", Value: "t3.micro"}}}
		change(&spec)
		return spec
	}
	for _, tt := range []struct {
		name    string
		content string
		file    string
		spec    NewResource
	}{
		{"empty name", "", "main.tf", valid(func(s *NewResource) { s.Name = "" })},
		{"name with digit first", "", "main.tf", valid(func(s *NewResource) { s.Name = "1web" })},
		{"name with space", "", "main.tf", valid(func(s *NewResource) { s.Name = "web server" })},
		{"name with quote", "", "main.tf", valid(func(s *NewResource) { s.Name = `web" {}` })},
		{"name with dot", "", "main.tf", valid(func(s *NewResource) { s.Name = "web.app" })},
		{"unicode name", "", "main.tf", valid(func(s *NewResource) { s.Name = "café" })},
		{"long name", "", "main.tf", valid(func(s *NewResource) { s.Name = strings.Repeat("a", 65) })},
		{"invalid type", "", "main.tf", valid(func(s *NewResource) { s.Type = "aws instance" })},
		{"invalid attribute", "", "main.tf", valid(func(s *NewResource) { s.Attributes[0].Name = "a = 1\nb" })},
		{"repeated attribute", "", "main.tf", valid(func(s *NewResource) { s.Attributes = append(s.Attributes, s.Attributes[0]) })},
		{"missing value", "", "main.tf", valid(func(s *NewResource) { s.Attributes[0].Value = nil })},
		{"null expression", "", "main.tf", valid(func(s *NewResource) { s.Attributes[0] = NewAttribute{Name: "ami", Expression: "null"} })},
		{"value and expression", "", "main.tf", valid(func(s *NewResource) { s.Attributes[0].Expression = "var.x" })},
		{"list value", "", "main.tf", valid(func(s *NewResource) { s.Attributes[0].Value = []any{"a"} })},
		{"nan", "", "main.tf", valid(func(s *NewResource) { s.Attributes[0].Value = math.NaN() })},
		{"imprecise number", "", "main.tf", valid(func(s *NewResource) { s.Attributes[0].Value = json.Number("9007199254740993") })},
		{"block injection", "", "main.tf", valid(expression("1\n}\nresource \"x\" \"y\" {"))},
		{"trailing tokens", "", "main.tf", valid(expression("var.a var.b"))},
		{"invalid file HCL", "resource \"aws_vpc\" {", "main.tf", valid(func(*NewResource) {})},
		{"json file", "", "main.tf.json", valid(func(*NewResource) {})},
		{"unknown file", "", "missing.tf", valid(func(*NewResource) {})},
	} {
		t.Run(tt.name, func(t *testing.T) {
			files := map[string]string{"main.tf": tt.content, "main.tf.json": "{}"}
			got, _, err := InsertResource(files, tt.file, tt.spec)
			if err == nil || got != "" {
				t.Fatalf("invalid resource accepted: %q, %v", got, err)
			}
		})
	}
}

func TestValidName(t *testing.T) {
	for _, name := range []string{"a", "_", "web_1", "web-1", "AWS_vpc"} {
		if !ValidName(name) {
			t.Errorf("%q should be valid", name)
		}
	}
	for _, name := range []string{"", "1a", "-a", "a.b", "a b", "ñ", "a\n", strings.Repeat("x", 65)} {
		if ValidName(name) {
			t.Errorf("%q should be invalid", name)
		}
	}
}

// Whatever the existing file holds, a successful insertion keeps it as an
// exact prefix and yields valid HCL with the new resource.
func FuzzInsertResourceKeepsBytes(f *testing.F) {
	for _, seed := range []string{"", "# a", "resource \"aws_vpc\" \"main\" {}\n", "locals {\r\n  a = 1\r\n}", "# 日本語 sin salto", "/* comentario */", string([]byte{0xff, 0xfe})} {
		f.Add(seed, "app", "10.0.1.0/24")
	}
	f.Fuzz(func(t *testing.T, content, name, value string) {
		if len(content) > 65536 {
			t.Skip()
		}
		spec := NewResource{Type: "aws_subnet", Name: name, Attributes: []NewAttribute{{Name: "cidr_block", Value: value}, {Name: "vpc_id", Expression: "aws_vpc.main.id"}}}
		updated, line, err := InsertResource(map[string]string{"main.tf": content}, "main.tf", spec)
		if err != nil {
			return
		}
		if !strings.HasPrefix(updated, content) {
			t.Fatal("insertion changed existing bytes")
		}
		a := Parse(map[string]string{"main.tf": updated})
		if !a.Valid {
			t.Fatalf("insertion produced invalid HCL: %q", updated)
		}
		found := false
		for _, r := range a.Resources {
			if r.ID == "aws_subnet."+name && r.Line == line {
				found = true
			}
		}
		if !found {
			t.Fatalf("aws_subnet.%s not found at line %d", name, line)
		}
	})
}
