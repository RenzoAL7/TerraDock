const network = `# Ejemplo para explorar: no crea infraestructura.
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  enable_dns_support = true
}

resource "aws_subnet" "app" {
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "api" {
  ami = var.ami_id
  instance_type = "t3.micro"
  subnet_id = aws_subnet.app.id
  tags = { Name = "payments-api" }
}
`;

export const examples = [
  { id: "network", name: "Red y aplicación", content: network },
  {
    id: "two-subnets",
    name: "Dos subnets",
    content:
      network +
      `
resource "aws_subnet" "workers" {
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.2.0/24"
}

resource "aws_instance" "worker" {
  ami = var.ami_id
  instance_type = "t3.small"
  subnet_id = aws_subnet.workers.id
  tags = { Name = "background-worker" }
}
`,
  },
];
