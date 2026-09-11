package terraform

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func resourceByID(t *testing.T, a Analysis, id string) Resource {
	t.Helper()
	for _, r := range a.Resources {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("resource %s not found: %#v", id, a.Resources)
	return Resource{}
}

func propertyByName(t *testing.T, r Resource, name string) Property {
	t.Helper()
	for _, p := range r.Properties {
		if p.Name == name {
			return p
		}
	}
	t.Fatalf("property %s not found in %s", name, r.ID)
	return Property{}
}

func TestParseRootModuleReferencesAndSource(t *testing.T) {
	files := map[string]string{
		"network.tf": `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags = { Name = "VPC de demostración" }
}
resource "aws_subnet" "app" {
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`,
		"main.tf": `variable "size" { default = "t3.micro" }
data "aws_ami" "linux" { most_recent = true }
module "network" { source = "./modules/network" }
resource "aws_instance" "web" {
  instance_type = var.size
  ami = data.aws_ami.linux.id
  subnet_id = aws_subnet.app.id
  user_data = module.network.script
  count = var.replicas
  depends_on = [aws_vpc.main]
  tags = { VPC = aws_vpc.main.id }
}
`,
		"ignored.txt": `this is not Terraform`,
	}
	a := Parse(files)
	if !a.Valid || len(a.Resources) != 5 {
		t.Fatalf("unexpected analysis: %#v", a)
	}
	if got := resourceByID(t, a, "aws_vpc.main").Label; got != "VPC de demostración" {
		t.Fatalf("literal Name tag missing: %q", got)
	}
	web := resourceByID(t, a, "aws_instance.web")
	if web.File != "main.tf" || web.Line != 4 || web.ParentID != "aws_subnet.app" {
		t.Fatalf("wrong source or grouping: %#v", web)
	}
	p := propertyByName(t, web, "instance_type")
	if p.Expression != "var.size" || p.Editable || p.Value != nil || p.Line != 5 {
		t.Fatalf("variable default must not become a resolved value: %#v", p)
	}
	if !reflect.DeepEqual(web.DependsOn, []string{"aws_subnet.app", "aws_vpc.main", "data.aws_ami.linux", "module.network"}) {
		t.Fatalf("unexpected dependencies: %#v", web.DependsOn)
	}
	if len(a.Edges) != 6 || len(a.Diagnostics) != 2 {
		t.Fatalf("want references plus explicit dependency, module/count warnings: %#v", a)
	}
	// Filename/map iteration order cannot change diagram or diagnostic ordering.
	for i := 0; i < 10; i++ {
		if !reflect.DeepEqual(a, Parse(files)) {
			t.Fatal("analysis is nondeterministic")
		}
	}
}

func TestLiteralValuesAndNumericPrecision(t *testing.T) {
	for _, tt := range []struct {
		name, expression string
		value            any
		editable         bool
	}{
		{"false", "false", false, true},
		{"zero", "0", float64(0), true},
		{"decimal", "0.1", 0.1, true},
		{"negative", "-12", float64(-12), true},
		{"safe integer", "9007199254740991", float64(9007199254740991), true},
		{"large integer", "9007199254740993", nil, false},
		{"precise decimal", "0.1234567890123456789012345", nil, false},
		{"overflow", "1e9999", nil, false},
		{"null", "null", nil, false},
		{"function", "tonumber(20)", nil, false},
		{"computed", "10 + 10", nil, false},
		{"negated expression", "-(10 + 10)", nil, false},
		{"interpolation", `"${var.storage}"`, nil, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			a := Parse(map[string]string{"main.tf": "resource \"aws_db_instance\" \"db\" {\n allocated_storage = " + tt.expression + "\n}\n"})
			if !a.Valid {
				t.Fatalf("invalid analysis: %#v", a.Diagnostics)
			}
			p := propertyByName(t, a.Resources[0], "allocated_storage")
			if p.Editable != tt.editable || !reflect.DeepEqual(p.Value, tt.value) || p.Expression != tt.expression {
				t.Fatalf("unexpected property: %#v", p)
			}
			b, err := json.Marshal(p)
			if err != nil {
				t.Fatal(err)
			}
			if tt.value != nil && !strings.Contains(string(b), `"value":`) {
				t.Fatalf("zero/false literal omitted from JSON: %s", b)
			}
		})
	}
}

func TestParseReportsInvalidAndUnsupportedInputs(t *testing.T) {
	for _, tt := range []struct {
		name    string
		files   map[string]string
		valid   bool
		message string
	}{
		{"invalid HCL", map[string]string{"broken.tf": `resource "aws_vpc" "x" { cidr_block = }`}, false, "Invalid expression"},
		{"duplicate", map[string]string{"a.tf": `resource "aws_vpc" "x" {}`, "b.tf": `resource "aws_vpc" "x" {}`}, false, "Declaración duplicada"},
		{"missing labels", map[string]string{"a.tf": `resource "aws_vpc" {}`}, false, "etiquetas"},
		{"JSON config", map[string]string{"main.tf.json": `{}`}, true, ".tf.json"},
		{"unresolved", map[string]string{"main.tf": `resource "aws_instance" "web" { subnet_id = aws_subnet.missing.id }`}, true, "no se encontró"},
		{"instances", map[string]string{"main.tf": `resource "aws_instance" "web" { for_each = var.instances }`}, true, "sin expandir"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			a := Parse(tt.files)
			if a.Valid != tt.valid || len(a.Diagnostics) == 0 {
				t.Fatalf("unexpected validation state: %#v", a)
			}
			found := false
			for _, d := range a.Diagnostics {
				if strings.Contains(d.Message, tt.message) && d.File != "" && d.Line > 0 {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing source diagnostic %q: %#v", tt.message, a.Diagnostics)
			}
		})
	}
}

func TestContainerReferencesCannotProduceLayoutCycles(t *testing.T) {
	a := Parse(map[string]string{"main.tf": `resource "aws_vpc" "main" { subnet_id = aws_subnet.app.id }
resource "aws_subnet" "app" { vpc_id = aws_vpc.main.id }
resource "aws_subnet" "second" { subnet_id = aws_subnet.app.id }
data "aws_vpc" "existing" {}
resource "aws_instance" "web" { vpc_id = data.aws_vpc.existing.id }
`})
	for _, id := range []string{"aws_vpc.main", "aws_subnet.second", "aws_instance.web"} {
		if p := resourceByID(t, a, id).ParentID; p != "" {
			t.Fatalf("%s has invalid container %s", id, p)
		}
	}
	if p := resourceByID(t, a, "aws_subnet.app").ParentID; p != "aws_vpc.main" {
		t.Fatalf("legitimate VPC grouping lost: %s", p)
	}
}
