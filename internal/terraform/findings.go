package terraform

import (
	"fmt"
	"net/netip"

	"github.com/hashicorp/hcl/v2/hclsyntax"
)

// These checks use only literals and direct references. They are evidence about
// declared configuration, not a security audit or an assertion of reachability.
func findIssues(decls []declaration, byID map[string]int) []Finding {
	findings := []Finding{}
	for _, d := range decls {
		if d.block.Type != "resource" {
			continue
		}
		if d.resource.Type == "aws_subnet" && d.resource.ParentID != "" {
			if index, exists := byID[d.resource.ParentID]; exists && decls[index].resource.Type == "aws_vpc" {
				vpc := decls[index]
				subnetCIDR, subnetOK := stringAttribute(d.block.Body, "cidr_block")
				vpcCIDR, vpcOK := stringAttribute(vpc.block.Body, "cidr_block")
				if subnetOK && vpcOK {
					subnetPrefix, subnetErr := netip.ParsePrefix(subnetCIDR)
					vpcPrefix, vpcErr := netip.ParsePrefix(vpcCIDR)
					if subnetErr == nil && vpcErr == nil && (subnetPrefix.Bits() < vpcPrefix.Bits() || !vpcPrefix.Contains(subnetPrefix.Masked().Addr())) {
						findings = append(findings, Finding{
							ID: "subnet-outside-vpc:" + d.resource.ID, Severity: "warning", ResourceID: d.resource.ID,
							Title:  "CIDR de subnet fuera de la VPC",
							Detail: fmt.Sprintf("El rango declarado %s no está contenido en %s (%s). Comprobación estática de valores literales.", subnetCIDR, vpcCIDR, vpc.resource.ID),
							File:   d.resource.File, Line: d.block.Body.Attributes["cidr_block"].NameRange.Start.Line,
						})
					}
				}
			}
		}
		if d.resource.Type == "aws_security_group" {
			for _, nested := range d.block.Body.Blocks {
				if nested.Type == "ingress" && allowsPublicSSH(nested.Body) {
					findings = append(findings, publicSSHFinding(d.resource, nested.TypeRange.Start.Line))
					break
				}
			}
		}
		if d.resource.Type == "aws_security_group_rule" {
			if ruleType, ok := stringAttribute(d.block.Body, "type"); ok && ruleType == "ingress" && allowsPublicSSH(d.block.Body) {
				findings = append(findings, publicSSHFinding(d.resource, d.resource.Line))
			}
		}
		if d.resource.Type == "aws_vpc_security_group_ingress_rule" && allowsPublicSSH(d.block.Body) {
			findings = append(findings, publicSSHFinding(d.resource, d.resource.Line))
		}
	}
	return findings
}

func publicSSHFinding(resource Resource, line int) Finding {
	return Finding{
		ID: "public-ssh:" + resource.ID, Severity: "warning", ResourceID: resource.ID,
		Title:  "Regla permite SSH desde cualquier IP",
		Detail: "Una regla de entrada declarada permite TCP/22 desde 0.0.0.0/0 o ::/0. Restringe el origen si SSH es necesario. La revisión no evalúa rutas, ACL ni acceso efectivo.",
		File:   resource.File, Line: line,
	}
}

func stringAttribute(body *hclsyntax.Body, name string) (string, bool) {
	attr := body.Attributes[name]
	if attr == nil {
		return "", false
	}
	value, literal := literalValue(attr.Expr)
	text, ok := value.(string)
	return text, literal && ok
}

func numberAttribute(body *hclsyntax.Body, name string) (float64, bool) {
	attr := body.Attributes[name]
	if attr == nil {
		return 0, false
	}
	value, literal := literalValue(attr.Expr)
	number, ok := value.(float64)
	return number, literal && ok
}

func allowsPublicSSH(body *hclsyntax.Body) bool {
	protocol, ok := stringAttribute(body, "protocol")
	if !ok {
		protocol, ok = stringAttribute(body, "ip_protocol")
	}
	if !ok || (protocol != "tcp" && protocol != "6" && protocol != "-1") {
		return false
	}
	if protocol != "-1" {
		from, fromOK := numberAttribute(body, "from_port")
		to, toOK := numberAttribute(body, "to_port")
		if !fromOK || !toOK || from > 22 || to < 22 {
			return false
		}
	}
	for _, name := range []string{"cidr_ipv4", "cidr_ipv6"} {
		if cidr, ok := stringAttribute(body, name); ok && (cidr == "0.0.0.0/0" || cidr == "::/0") {
			return true
		}
	}
	for _, name := range []string{"cidr_blocks", "ipv6_cidr_blocks"} {
		attr := body.Attributes[name]
		if attr == nil {
			continue
		}
		list, ok := attr.Expr.(*hclsyntax.TupleConsExpr)
		if !ok {
			continue
		}
		for _, expr := range list.Exprs {
			value, ok := literalValue(expr)
			if !ok {
				continue
			}
			if value == "0.0.0.0/0" || value == "::/0" {
				return true
			}
		}
	}
	return false
}
