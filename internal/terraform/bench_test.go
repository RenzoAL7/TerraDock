package terraform

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// LargeProject builds a realistic module with n resource blocks spread over
// several files: VPCs, subnets, security groups and instances referencing them.
func LargeProject(n int) map[string]string {
	files := map[string]string{}
	var b strings.Builder
	file := 0
	flush := func() {
		files[fmt.Sprintf("part%02d.tf", file)] = b.String()
		b.Reset()
		file++
	}
	for i := 0; i < n; i++ {
		vpc := i / 30
		switch i % 4 {
		case 0:
			fmt.Fprintf(&b, "resource \"aws_vpc\" \"v%d\" {\n  cidr_block = \"10.%d.0.0/16\"\n  enable_dns_support = true\n  tags = { Name = \"vpc-%d\" }\n}\n\n", i, i%250, i)
		case 1:
			fmt.Fprintf(&b, "resource \"aws_subnet\" \"s%d\" {\n  vpc_id = aws_vpc.v%d.id\n  cidr_block = \"10.%d.%d.0/24\"\n  availability_zone = \"us-east-1a\"\n}\n\n", i, vpc*30-(vpc*30)%4, (i-1)%250, i%250)
		case 2:
			fmt.Fprintf(&b, "resource \"aws_security_group\" \"g%d\" {\n  vpc_id = aws_vpc.v%d.id\n  description = \"group %d\"\n  ingress {\n    from_port = 443\n    to_port = 443\n    protocol = \"tcp\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n}\n\n", i, vpc*30-(vpc*30)%4, i)
		case 3:
			fmt.Fprintf(&b, "resource \"aws_instance\" \"i%d\" {\n  ami = var.ami_id\n  instance_type = \"t3.micro\"\n  subnet_id = aws_subnet.s%d.id\n  vpc_security_group_ids = [aws_security_group.g%d.id]\n  tags = { Name = \"app-%d\" }\n}\n\n", i, i-2, i-1, i)
		}
		if b.Len() > 6000 {
			flush()
		}
	}
	fmt.Fprintf(&b, "variable \"ami_id\" {\n  type = string\n}\n")
	flush()
	return files
}

func TestLargeProjectParses(t *testing.T) {
	a := Parse(LargeProject(300))
	// 300 resources plus the ami_id variable they all reference.
	if !a.Valid || len(a.Resources) != 301 || len(a.Edges) < 200 {
		t.Fatalf("valid=%v resources=%d edges=%d diags=%v", a.Valid, len(a.Resources), len(a.Edges), a.Diagnostics)
	}
}

func BenchmarkParse300(b *testing.B) {
	files := LargeProject(300)
	b.ReportAllocs()
	for b.Loop() {
		Parse(files)
	}
}

func BenchmarkParse1000(b *testing.B) {
	files := LargeProject(1000)
	b.ReportAllocs()
	for b.Loop() {
		Parse(files)
	}
}

// TERRADOCK_DUMP=dir go test -run TestDumpLargeProject writes the fixture for browser timing.
func TestDumpLargeProject(t *testing.T) {
	dir := os.Getenv("TERRADOCK_DUMP")
	if dir == "" {
		t.Skip("set TERRADOCK_DUMP to write the fixture")
	}
	n, _ := strconv.Atoi(os.Getenv("TERRADOCK_DUMP_N"))
	if n == 0 {
		n = 300
	}
	for name, body := range LargeProject(n) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
