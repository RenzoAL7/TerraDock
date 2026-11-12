package floci

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateEndpointOnlyAllowsLocalTargets(t *testing.T) {
	for _, ok := range []string{"http://localhost:4566", "http://127.0.0.1:4566/", "http://localhost.floci.io:4566", "https://[::1]:4566"} {
		if _, err := ValidateEndpoint(ok); err != nil {
			t.Errorf("%s should be allowed: %v", ok, err)
		}
	}
	for _, bad := range []string{"https://ec2.us-east-1.amazonaws.com", "http://10.0.0.5:4566", "ftp://localhost", "http://localhost:4566/x", "http://evil.floci.io.example.com", "http://user@localhost:4566"} {
		if _, err := ValidateEndpoint(bad); err == nil {
			t.Errorf("%s should be rejected", bad)
		}
	}
}

func TestResourceIDMapsRootAddresses(t *testing.T) {
	cases := map[string]string{
		"aws_instance.web":        "aws_instance.web",
		"aws_instance.web[0]":     "aws_instance.web",
		`aws_subnet.private["a"]`: "aws_subnet.private",
		"module.net.aws_vpc.main": "",
		"data.aws_ami.ubuntu":     "",
	}
	for in, want := range cases {
		if got := ResourceID(in); got != want {
			t.Errorf("ResourceID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParsePlanSummarizesActionsPerResource(t *testing.T) {
	plan, err := ParsePlan([]byte(`{"resource_changes":[
	 {"address":"aws_vpc.main","mode":"managed","change":{"actions":["create"]}},
	 {"address":"aws_subnet.a[0]","mode":"managed","change":{"actions":["update"]}},
	 {"address":"aws_subnet.a[1]","mode":"managed","change":{"actions":["delete","create"]}},
	 {"address":"aws_s3_bucket.logs","mode":"managed","change":{"actions":["delete"]}},
	 {"address":"aws_iam_role.r","mode":"managed","change":{"actions":["no-op"]}},
	 {"address":"data.aws_ami.x","mode":"data","change":{"actions":["read"]}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"aws_vpc.main": "create", "aws_subnet.a": "replace", "aws_s3_bucket.logs": "delete"}
	if len(plan.Changes) != len(want) {
		t.Fatalf("changes = %v", plan.Changes)
	}
	for id, action := range want {
		if plan.Changes[id] != action {
			t.Errorf("%s = %q, want %q", id, plan.Changes[id], action)
		}
	}
	if plan.Counts["create"] != 1 || plan.Counts["update"] != 1 || plan.Counts["replace"] != 1 || plan.Counts["delete"] != 1 {
		t.Errorf("counts = %v", plan.Counts)
	}
}

func TestParseStateListsManagedRootResources(t *testing.T) {
	ids, err := ParseState([]byte(`{"values":{"root_module":{"resources":[
	 {"address":"aws_vpc.main","mode":"managed"},{"address":"aws_subnet.a[0]","mode":"managed"},
	 {"address":"aws_subnet.a[1]","mode":"managed"},{"address":"data.aws_ami.x","mode":"data"}]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(ids, ",") != "aws_subnet.a,aws_vpc.main" {
		t.Fatalf("ids = %v", ids)
	}
	empty, err := ParseState([]byte(`{"format_version":"1.0"}`))
	if err != nil || len(empty) != 0 {
		t.Fatal("empty state should produce no resources")
	}
}

func TestStageRedirectsProvidersWithoutTouchingSource(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{
		"main.tf": `provider "aws" { region = "eu-west-1" }
provider "aws" {
  alias  = "use1"
  region = "us-east-1"
}
terraform {
  backend "s3" { bucket = "real-state" }
}
resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
`,
	}
	if err := os.WriteFile(filepath.Join(dir, "stale.tf"), []byte("garbage"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "terraform.tfstate"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	layout, err := Stage(dir, files, "http://localhost:4566", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if layout.GeneratedProvider || strings.Join(layout.Aliases, ",") != ",use1" {
		t.Fatalf("layout = %+v", layout)
	}
	if _, err := os.Stat(filepath.Join(dir, "stale.tf")); !os.IsNotExist(err) {
		t.Fatal("stale staged file was kept")
	}
	if _, err := os.Stat(filepath.Join(dir, "terraform.tfstate")); err != nil {
		t.Fatal("state must survive restaging")
	}
	override, _ := os.ReadFile(filepath.Join(dir, overrideFile))
	text := string(override)
	for _, want := range []string{`backend "local"`, `alias = "use1"`, `ec2 = "http://localhost:4566"`, `access_key                  = "test"`} {
		if !strings.Contains(text, want) {
			t.Errorf("override missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "region") {
		t.Error("override must keep the project's own region")
	}
}

func TestStageGeneratesProviderAndRejectsUnsupportedConfig(t *testing.T) {
	dir := t.TempDir()
	layout, err := Stage(dir, map[string]string{"main.tf": `resource "aws_s3_bucket" "b" {}`}, "http://localhost:4566", nil, nil)
	if err != nil || !layout.GeneratedProvider {
		t.Fatalf("expected generated provider: %+v %v", layout, err)
	}
	if body, err := os.ReadFile(filepath.Join(dir, providerFile)); err != nil || !strings.Contains(string(body), `region = "us-east-1"`) {
		t.Fatal("provider file not generated")
	}
	if _, err := Stage(dir, map[string]string{"main.tf": "terraform {\n cloud {}\n}\n"}, "http://localhost:4566", nil, nil); err == nil {
		t.Fatal("cloud block must be rejected")
	}
	if _, err := Stage(dir, map[string]string{"main.tf": `resource "x" {`}, "http://localhost:4566", nil, nil); err == nil {
		t.Fatal("invalid HCL must be rejected")
	}
	if _, err := Stage(dir, map[string]string{overrideFile: ""}, "http://localhost:4566", nil, nil); err == nil {
		t.Fatal("reserved file names must be rejected")
	}
}

func TestStartRequiresMatchingProjectAndFreshPlan(t *testing.T) {
	files := map[string]string{"main.tf": `resource "aws_s3_bucket" "b" {}`}
	r, err := New(Config{StateDir: t.TempDir(), Terraform: "/bin/true"}, func() Project { return Project{ID: "p1", Name: "demo", Files: files} })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Start("plan", "other", nil); err == nil {
		t.Fatal("project mismatch must be rejected")
	}
	if _, err := r.Start("apply", "p1", nil); err == nil {
		t.Fatal("apply without plan must be rejected")
	}
	r.plans["p1"] = &Plan{Fingerprint: "old"}
	if _, err := r.Start("apply", "p1", nil); err == nil || !strings.Contains(err.Error(), "cambiaron") {
		t.Fatalf("stale plan must be rejected, got %v", err)
	}
	if _, err := r.Start("rm", "p1", nil); err == nil {
		t.Fatal("unknown action must be rejected")
	}
}

func TestVariablesAndValuesAreStagedFromTFVarsAndInput(t *testing.T) {
	files := map[string]string{"main.tf": `variable "ami_id" {
  description = "AMI"
}
variable "size" {
  default = "t3.micro"
}
variable "count_n" {}
`}
	tfvars := map[string]string{"terraform.tfvars": `count_n = 2`}
	vars := Variables(files, tfvars)
	if len(vars) != 3 {
		t.Fatalf("vars = %+v", vars)
	}
	byName := map[string]Variable{}
	for _, v := range vars {
		byName[v.Name] = v
	}
	if !byName["ami_id"].Required || byName["ami_id"].Provided || byName["ami_id"].Description != "AMI" {
		t.Errorf("ami_id = %+v", byName["ami_id"])
	}
	if byName["size"].Required || !byName["count_n"].Provided {
		t.Errorf("size/count = %+v %+v", byName["size"], byName["count_n"])
	}
	dir := t.TempDir()
	if _, err := Stage(dir, files, "http://localhost:4566", tfvars, map[string]string{"ami_id": "ami-123", "count_n": "3"}); err != nil {
		t.Fatal(err)
	}
	if body, _ := os.ReadFile(filepath.Join(dir, "terraform.tfvars")); string(body) != "count_n = 2" {
		t.Error("project tfvars not copied")
	}
	body, _ := os.ReadFile(filepath.Join(dir, valuesFile))
	if !strings.Contains(string(body), `"ami_id": "ami-123"`) || !strings.Contains(string(body), `"count_n": 3`) {
		t.Errorf("values file = %s", body)
	}
}

func TestStartRejectsUndeclaredVariables(t *testing.T) {
	files := map[string]string{"main.tf": `variable "a" {}`}
	r, err := New(Config{StateDir: t.TempDir(), Terraform: "/bin/true"}, func() Project { return Project{ID: "p1", Files: files} })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Start("plan", "p1", map[string]string{"b": "x"}); err == nil {
		t.Fatal("undeclared variable must be rejected")
	}
}
