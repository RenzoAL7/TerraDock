package publicdemo

import (
	"encoding/json"
	"strings"
	"testing"
)

const example = `# Preserve this comment.
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_subnet" "app" {
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
resource "aws_instance" "api" {
  instance_type = "t3.micro" # Preserve this too.
  subnet_id = aws_subnet.app.id
}
`

func TestBrowserEditsUseRealParserAndPreserveSource(t *testing.T) {
	r := Handle(Request{Operation: "edit", Content: example, ResourceID: "aws_instance.api", Property: "instance_type", Value: "t3.small"})
	if r.Error != "" || r.Analysis == nil || !r.Analysis.Valid {
		t.Fatalf("edit failed: %+v", r)
	}
	if r.Content != strings.Replace(example, "t3.micro", "t3.small", 1) {
		t.Fatal("unrelated source changed")
	}
	if len(r.Analysis.Resources) != 3 || len(r.Analysis.Edges) != 2 || r.Analysis.Resources[2].ParentID != "aws_subnet.app" {
		t.Fatal("source-derived graph lost its relationships")
	}
}

func TestInvalidAndComputedSourceIsNeverSilentlyEdited(t *testing.T) {
	broken := Handle(Request{Operation: "parse", Content: example + `resource "aws_vpc" "broken" {`})
	if broken.Analysis == nil || broken.Analysis.Valid || len(broken.Analysis.Diagnostics) == 0 {
		t.Fatal("syntax error not reported")
	}
	computed := strings.Replace(example, `"t3.micro"`, "var.instance_type", 1)
	r := Handle(Request{Operation: "edit", Content: computed, ResourceID: "aws_instance.api", Property: "instance_type", Value: "t3.small"})
	if r.Error == "" || r.Content != "" {
		t.Fatal("computed value was overwritten")
	}
}

func TestBrowserBoundaryRejectsUnsupportedOperationsAndLargeInputs(t *testing.T) {
	for _, request := range []Request{
		{Operation: "apply", Content: example},
		{Operation: "parse", Content: strings.Repeat("x", MaxSourceBytes+1)},
		{Operation: "parse", Content: strings.Repeat("\n", 1002)},
	} {
		if Handle(request).Error == "" {
			t.Fatal("unbounded or unsupported request accepted")
		}
	}
	var r Response
	if err := json.Unmarshal([]byte(HandleJSON("not json")), &r); err != nil || r.Error == "" {
		t.Fatal("invalid bridge response")
	}
	empty := Handle(Request{Operation: "parse", Content: ""})
	if empty.Analysis == nil || len(empty.Analysis.Resources) != 0 || !empty.Analysis.Valid {
		t.Fatal("empty file should produce an empty graph")
	}
}
