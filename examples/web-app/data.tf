variable "ami_id" {
  type        = string
  description = "AMI específica de la región; no se evalúa en esta demo"
}

resource "aws_db_subnet_group" "main" {
  name       = "terradock-database"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

resource "aws_db_instance" "postgres" {
  identifier                  = "terradock-postgres"
  engine                      = "postgres"
  instance_class              = "db.t3.micro"
  allocated_storage           = 20
  multi_az                    = false
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  username                    = "appadmin"
  manage_master_user_password = true

  tags = { Name = "postgres-database" }
}

resource "aws_s3_bucket" "assets" {
  bucket_prefix = "terradock-demo-assets-"

  tags = { Name = "static-assets" }
}
