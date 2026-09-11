# Proyectos de ejemplo

Estos archivos son **fixtures ilustrativos del parser, editor y diagrama**. La
demo los carga en memoria: cambiar una propiedad del ejemplo no modifica estos
archivos del repositorio ni crea recursos en AWS.

- `basic-vpc`: VPC, subnet e instancia EC2; punto de partida para probar edición
  de `cidr_block` e `instance_type` y navegación entre código y gráfico.
- `web-app`: 15 declaraciones AWS repartidas entre red, aplicación y datos. Incluye
  una regla SSH amplia de forma deliberada para demostrar un hallazgo basado en
  código. Los nombres `public` y `private` expresan la intención del ejemplo; no
  prueban conectividad, ya que no se incluyen tablas de rutas.

No son plantillas listas para desplegar. Faltan configuración de proveedores,
valores específicos del entorno, rutas, listeners y otros elementos operativos.
No ejecutes `terraform apply` sobre estos fixtures. TerraDock no invoca Terraform
ni conecta con AWS. Las direcciones de los nodos representan declaraciones, no
infraestructura desplegada.
