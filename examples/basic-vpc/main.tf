# Ejemplo ilustrativo: editar este proyecto en la demo no crea recursos en AWS.
# La AMI debe definirse para un entorno real; TerraDock conserva la expresión.
variable "ami_id" {
  type        = string
  description = "AMI elegida para la región de despliegue"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "demo-vpc" }
}

resource "aws_subnet" "app" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"

  tags = { Name = "app-subnet" }
}

resource "aws_instance" "web" {
  ami           = var.ami_id
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id

  tags = { Name = "web-server" }
}
