import { Code2, Cpu, FileCode2, Hexagon, Network } from "lucide-react";

const exampleCode = [
  "# payments-api / main.tf",
  "",
  'resource "aws_vpc" "main" {',
  '  cidr_block = "10.0.0.0/16"',
  "}",
  "",
  'resource "aws_subnet" "app" {',
  "  vpc_id = aws_vpc.main.id",
  '  cidr_block = "10.0.1.0/24"',
  "}",
  "",
  'resource "aws_instance" "api" {',
  "  ami = var.ami_id",
  '  instance_type = "t3.micro"',
  "  subnet_id = aws_subnet.app.id",
  "}",
];

function CodeSample() {
  return (
    <div className="example-code">
      <div className="example-panel-heading">
        <span>
          <FileCode2 size={14} /> main.tf
        </span>
        <span className="example-language">HCL</span>
      </div>
      <pre aria-label="Fragmento ilustrativo de Terraform: VPC, subnet e instancia EC2">
        <code>
          {exampleCode.map((line, index) => (
            <span
              className={`code-line${index === 13 ? " code-highlight" : ""}`}
              key={index}
            >
              <span className="line-number" aria-hidden="true">
                {index + 1}
              </span>
              <span>
                {line.startsWith("#") ? (
                  <span className="syntax-comment">{line}</span>
                ) : (
                  line.split(/("[^"]*"|\bresource\b)/g).map((part, token) => (
                    <span
                      className={
                        part.startsWith('"')
                          ? "syntax-string"
                          : part === "resource"
                            ? "syntax-keyword"
                            : undefined
                      }
                      key={token}
                    >
                      {part}
                    </span>
                  ))
                )}
                {"\n"}
              </span>
            </span>
          ))}
        </code>
      </pre>
      <div className="example-code-footer">
        <Code2 size={13} /> Fragmento de configuración
      </div>
    </div>
  );
}

function ArchitectureSample() {
  return (
    <div
      className="example-architecture"
      role="img"
      aria-label="Arquitectura de ejemplo: la VPC main contiene la subnet app, que contiene la instancia EC2 api de tipo t3.micro. Son recursos declarados, no un despliegue verificado."
    >
      <div className="example-panel-heading">
        <span>
          <Network size={14} /> Arquitectura
        </span>
        <span className="example-language">AWS</span>
      </div>
      <div className="architecture-canvas">
        <div className="architecture-label">
          <span className="status-dot" /> Configuración declarada
        </div>
        <div className="vpc-boundary">
          <div className="resource-heading">
            <Hexagon size={18} />
            <div>
              <strong>VPC · main</strong>
              <span>10.0.0.0/16</span>
            </div>
          </div>
          <div className="graph-connector" />
          <div className="subnet-boundary">
            <div className="subnet-heading">
              <Network size={14} />
              <span>SUBNET · app</span>
            </div>
            <div className="subnet-cidr">10.0.1.0/24</div>
            <div className="graph-connector" />
            <div className="instance-node">
              <span className="instance-icon">
                <Cpu size={23} />
              </span>
              <div>
                <strong>api</strong>
                <span>EC2 · t3.micro</span>
              </div>
            </div>
            <div className="node-reference">aws_instance.api</div>
          </div>
        </div>
        <div className="graph-caption">
          Una vista de lo que describe tu código.
        </div>
      </div>
      <div className="example-graph-footer">
        <span className="status-dot" /> 3 recursos declarados
      </div>
    </div>
  );
}

export function EditorExample() {
  return (
    <figure
      className="editor-example"
      id="ejemplo"
      tabIndex={-1}
      aria-labelledby="example-caption"
    >
      <div className="example-topbar">
        <span className="example-project">
          <span className="project-dot" /> payments-api
        </span>
        <span className="example-badge">Ejemplo estático</span>
      </div>
      <div
        className="example-scroll"
        role="region"
        aria-label="Muestra del editor: código a la izquierda y arquitectura a la derecha"
        tabIndex={0}
      >
        <div className="example-split">
          <CodeSample />
          <ArchitectureSample />
        </div>
      </div>
      <figcaption id="example-caption">
        Vista ilustrativa del editor. No edita archivos ni representa
        infraestructura desplegada.
      </figcaption>
    </figure>
  );
}
