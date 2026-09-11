package terraform

import (
	"strings"
	"testing"
)

func TestSubnetFindingRequiresLiteralEvidence(t *testing.T) {
	for _, tt := range []struct {
		name, vpc, subnet string
		want              bool
	}{
		{"contained", `"10.0.0.0/16"`, `"10.0.1.0/24"`, false},
		{"outside", `"10.0.0.0/16"`, `"172.16.1.0/24"`, true},
		{"broader", `"10.0.0.0/16"`, `"10.0.0.0/8"`, true},
		{"variable", "var.vpc_cidr", `"172.16.1.0/24"`, false},
		{"computed", `"10.0.0.0/16"`, "cidrsubnet(var.cidr, 8, 1)", false},
		{"invalid prefix", `"10.0.0.0/16"`, `"invalid"`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			source := "resource \"aws_vpc\" \"main\" { cidr_block = " + tt.vpc + " }\n" +
				"resource \"aws_subnet\" \"app\" {\n vpc_id = aws_vpc.main.id\n cidr_block = " + tt.subnet + "\n}\n"
			a := Parse(map[string]string{"network.tf": source})
			if (len(a.Findings) == 1) != tt.want {
				t.Fatalf("unexpected finding: %#v", a.Findings)
			}
			if tt.want && (a.Findings[0].File != "network.tf" || a.Findings[0].Line != 4 || !strings.Contains(a.Findings[0].Detail, "aws_vpc.main")) {
				t.Fatalf("missing source evidence: %#v", a.Findings[0])
			}
		})
	}
}

func TestPublicSSHFindingsAreStaticAndProtocolSpecific(t *testing.T) {
	for _, tt := range []struct {
		name, source string
		want         bool
	}{
		{"inline SSH", `resource "aws_security_group" "app" {
 ingress {
 from_port = 22
 to_port = 22
 protocol = "tcp"
 cidr_blocks = ["0.0.0.0/0"]
 }
}`, true},
		{"separate IPv6 SSH", `resource "aws_security_group_rule" "ssh" {
 type = "ingress"
 from_port = 20
 to_port = 25
 protocol = "6"
 ipv6_cidr_blocks = ["::/0"]
}`, true},
		{"new all protocols rule", `resource "aws_vpc_security_group_ingress_rule" "ssh" {
 ip_protocol = "-1"
 cidr_ipv4 = "0.0.0.0/0"
}`, true},
		{"restricted CIDR", `resource "aws_vpc_security_group_ingress_rule" "ssh" {
 ip_protocol = "tcp"
 from_port = 22
 to_port = 22
 cidr_ipv4 = "10.0.0.0/8"
}`, false},
		{"UDP not SSH", `resource "aws_vpc_security_group_ingress_rule" "ssh" {
 ip_protocol = "udp"
 from_port = 22
 to_port = 22
 cidr_ipv4 = "0.0.0.0/0"
}`, false},
		{"HTTPS", `resource "aws_vpc_security_group_ingress_rule" "ssh" {
 ip_protocol = "tcp"
 from_port = 443
 to_port = 443
 cidr_ipv4 = "0.0.0.0/0"
}`, false},
		{"unresolved port", `resource "aws_vpc_security_group_ingress_rule" "ssh" {
 ip_protocol = "tcp"
 from_port = var.port
 to_port = 22
 cidr_ipv4 = "0.0.0.0/0"
}`, false},
		{"egress", `resource "aws_security_group_rule" "ssh" {
 type = "egress"
 from_port = 22
 to_port = 22
 protocol = "tcp"
 cidr_blocks = ["0.0.0.0/0"]
}`, false},
		{"data source is not a managed rule", `data "aws_vpc_security_group_ingress_rule" "ssh" {
 ip_protocol = "-1"
 cidr_ipv4 = "0.0.0.0/0"
}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			a := Parse(map[string]string{"security.tf": tt.source})
			if !a.Valid || (len(a.Findings) == 1) != tt.want {
				t.Fatalf("unexpected analysis: %#v", a)
			}
			if tt.want {
				f := a.Findings[0]
				if f.File != "security.tf" || f.Line < 1 || f.ResourceID == "" || !strings.Contains(f.Detail, "no evalúa rutas") {
					t.Fatalf("finding omitted evidence or limits: %#v", f)
				}
			}
		})
	}
}
