# Recursos de aplicación para explorar referencias. No es un despliegue completo.
resource "aws_lb" "web" {
  name               = "terradock-web"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.load_balancer.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  tags = { Name = "web-load-balancer" }
}

resource "aws_instance" "app_a" {
  ami                    = var.ami_id
  instance_type          = "t3.small"
  subnet_id              = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.application.id]

  tags = { Name = "app-server-a" }
}

resource "aws_instance" "app_b" {
  ami                    = var.ami_id
  instance_type          = "t3.small"
  subnet_id              = aws_subnet.private_b.id
  vpc_security_group_ids = [aws_security_group.application.id]

  tags = { Name = "app-server-b" }
}
