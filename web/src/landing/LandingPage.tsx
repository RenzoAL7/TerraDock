import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  Download as DownloadIcon,
  FolderOpen,
  GitBranch,
  LockKeyhole,
  Network,
  PencilLine,
  Workflow,
} from "lucide-react";
import { Download, repository } from "./Download";
import { EditorExample } from "./EditorExample";
import fontLicensesUrl from "./font-licenses.txt?url";

const documentation = `${repository}#readme`;
const awsEmulator = "https://github.com/aws/aws-emulator";

/** Stacked layers: the Terraform violet plane over two Docker-blue strata. */
function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 29 10 16 17 3 10Z" fill="#8F7BFF" />
      <path
        d="M3 16l13 7 13-7"
        fill="none"
        stroke="#3AA0FF"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M3 22l13 7 13-7"
        fill="none"
        stroke="#3AA0FF"
        strokeWidth="2.6"
        strokeLinejoin="round"
        opacity=".55"
      />
    </svg>
  );
}

function Brand() {
  return (
    <a className="brand" href="#inicio" aria-label="TerraDock, inicio">
      <span className="brand-mark">
        <LogoMark />
      </span>
      <span>TerraDock</span>
    </a>
  );
}

function Header() {
  return (
    <header className="site-header">
      <div className="page-width header-inner">
        <Brand />
        <nav aria-label="Navegación principal">
          <a href="#descargar">Descargar</a>
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#funciones">Funciones</a>
          <a href={documentation}>
            Documentación <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </nav>
        <a className="source-link" href={repository}>
          <GitBranch size={15} aria-hidden="true" />
          <span>
            Código abierto <span className="source-license">Licencia MIT</span>
          </span>
        </a>
      </div>
    </header>
  );
}

/** Static terminal: the real commands to unpack and open TerraDock. */
function Terminal() {
  return (
    <figure
      className="terminal"
      aria-label="Terminal: descomprimir TerraDock y abrirlo en la carpeta de tu Terraform"
    >
      <div className="terminal-bar" aria-hidden="true">
        <span className="terminal-dot" />
        <span className="terminal-dot" />
        <span className="terminal-dot" />
        <span className="terminal-title">bash</span>
      </div>
      <pre>
        <code>
          <span className="terminal-comment">
            # Descomprime el binario de tu plataforma
          </span>
          {"\n"}tar -xzf terradock_darwin_arm64.tar.gz{"\n\n"}
          <span className="terminal-comment">
            # Ábrelo desde la carpeta con tus archivos .tf
          </span>
          {"\n"}cd infra <span className="terminal-op">&amp;&amp;</span>{" "}
          /ruta/a/terradock
        </code>
      </pre>
      <figcaption className="terminal-status">
        <span className="terminal-led" aria-hidden="true" />
        TerraDock en 127.0.0.1:7331 · código ↔ diagrama sincronizados
      </figcaption>
    </figure>
  );
}

const works = ["Terraform", "OpenTofu", "Floci", "AWS Emulator", "HCL nativo"];

const steps = [
  {
    icon: FolderOpen,
    title: "Abre tu Terraform",
    text: "Descarga TerraDock, ábrelo y elige una carpeta con archivos .tf. Tu configuración es el punto de partida.",
  },
  {
    icon: Network,
    title: "Encuentra las conexiones",
    text: "Explora los recursos declarados y sus referencias. Ve del diagrama al bloque de código que los define.",
  },
  {
    icon: PencilLine,
    title: "Edita con contexto",
    text: "Cambia el código o las propiedades y el diagrama se actualiza al instante, en ambos sentidos.",
  },
];

function HowItWorks() {
  return (
    <section
      className="how-section page-width"
      id="como-funciona"
      aria-labelledby="how-title"
      tabIndex={-1}
    >
      <div className="section-heading">
        <p className="eyebrow">CÓMO FUNCIONA</p>
        <h2 id="how-title">Entiende antes de cambiar.</h2>
        <p>
          El recorrido de la app local, desde el archivo hasta su arquitectura.
        </p>
      </div>
      <ol className="steps">
        {steps.map(({ icon: Icon, title, text }, index) => (
          <li className="step" key={title}>
            <div className="step-top">
              <span className="step-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className="step-number" aria-hidden="true">
                0{index + 1}
              </span>
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LocalDeploy() {
  return (
    <section className="deploy-section" aria-labelledby="deploy-title">
      <div className="page-width deploy-inner">
        <div className="deploy-copy">
          <p className="eyebrow">DESPLIEGUE LOCAL</p>
          <h2 id="deploy-title">
            Plan, apply y destroy. <span>Sin tocar AWS.</span>
          </h2>
          <p>
            Elige el emulador: <a href="https://floci.io">Floci</a>, de código
            abierto, o <a href={awsEmulator}>AWS Emulator</a>, el oficial de AWS
            (experimental). TerraDock trabaja sobre una copia privada de tus
            archivos y descarta tus credenciales reales.
          </p>
        </div>
        <figure
          className="deploy-card"
          aria-label="Ejemplo del panel Emulador: plan con 15 recursos para crear y apply completado"
        >
          <div className="emulator-switch" aria-hidden="true">
            <span>Floci</span>
            <span className="active">
              AWS Emulator <small>experimental</small>
            </span>
          </div>
          <div className="plan-chips" aria-hidden="true">
            <span className="chip-create">+15 crear</span>
            <span className="chip-update">~0 actualizar</span>
            <span className="chip-replace">±0 reemplazar</span>
            <span className="chip-delete">−0 eliminar</span>
          </div>
          <pre aria-hidden="true">
            <code>
              $ terraform apply terradock.tfplan{"\n"}
              aws_vpc.main: Creation complete{"\n"}
              aws_lb.web: Creation complete{"\n"}
              <span className="log-ok">
                Apply complete! Resources: 15 added.
              </span>
            </code>
          </pre>
        </figure>
      </div>
    </section>
  );
}

const currentFeatures = [
  {
    title: "Código y arquitectura conectados",
    text: "Recursos y referencias del módulo Terraform que abras en tu equipo.",
  },
  {
    title: "Sincronización en tiempo real",
    text: "Lo que escribes en el código, en el inspector o en otro editor llega al diagrama al momento.",
  },
  {
    title: "Diagnósticos y autoguardado",
    text: "Errores de sintaxis, guardado automático de HCL válido y protección ante conflictos.",
  },
  {
    title: "Despliegue local con Floci o AWS Emulator",
    text: "Plan, apply y destroy contra un AWS simulado en tu equipo, sin tocar tu cuenta real.",
  },
];

const plannedFeatures = [
  {
    title: "Borradores recuperables",
    text: "Recuperar los cambios sin guardar después de cerrar el navegador o reiniciar el equipo.",
  },
  {
    title: "Variables y módulos",
    text: "Variables, locals, outputs y módulos locales visibles en el diagrama.",
  },
  {
    title: "Crear recursos desde el diagrama",
    text: "Añadir y eliminar recursos compatibles, con vista previa del cambio en el código.",
  },
];

function Features() {
  return (
    <section
      className="features-section"
      id="funciones"
      aria-labelledby="features-title"
      tabIndex={-1}
    >
      <div className="page-width">
        <div className="section-heading">
          <p className="eyebrow">FUNCIONES Y ALCANCE</p>
          <h2 id="features-title">Una base real. Un camino por delante.</h2>
          <p>
            TerraDock se ejecuta en tu equipo: sin cuentas, sin servicio alojado
            y sin subir tus archivos. Esta web solo presenta el proyecto y una
            demo.
          </p>
        </div>
        <div className="feature-columns">
          <div className="feature-group available-features">
            <div className="feature-group-heading">
              <span className="availability-label">
                <span className="status-dot" /> Disponible en la app local
              </span>
              <Code2 size={21} aria-hidden="true" />
            </div>
            <ul>
              {currentFeatures.map(({ title, text }) => (
                <li key={title}>
                  <Check size={17} aria-hidden="true" />
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <a
              className="text-link"
              href={`${repository}/blob/main/docs/limitations.md`}
            >
              Consultar alcance y límites{" "}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
          <div className="feature-group planned-features">
            <div className="feature-group-heading">
              <span className="availability-label future-label">
                En el roadmap
              </span>
              <Workflow size={21} aria-hidden="true" />
            </div>
            <ul>
              {plannedFeatures.map(({ title, text }) => (
                <li key={title}>
                  <span className="future-marker" aria-hidden="true" />
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="planned-note">
              Funciones previstas para la app local; todavía no están
              disponibles.
            </p>
            <a
              className="text-link"
              href={`${repository}/blob/main/docs/roadmap.md`}
            >
              Ver roadmap <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className="nebula">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <div id="inicio">
        <Header />
      </div>
      <main id="contenido" tabIndex={-1}>
        <section className="hero page-width" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">
              <span>Tu Terraform.</span>
              <br />A la vista.
            </h1>
            <p className="hero-description">
              Código HCL y diagrama de arquitectura, sincronizados en vivo.
              Despliega en un AWS emulado en tu equipo: sin credenciales, sin
              factura, sin riesgo para tu cuenta.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="./demo/">
                Probar demo <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="button button-secondary" href="#descargar">
                <DownloadIcon size={18} aria-hidden="true" /> Descargar
              </a>
            </div>
            <p className="hero-note">
              <LockKeyhole size={14} aria-hidden="true" /> Prueba el editor con
              un ejemplo, sin cuenta ni credenciales cloud.
            </p>
          </div>
          <div className="hero-terminal">
            <Terminal />
            <p className="terminal-note">
              Un solo ejecutable para macOS, Linux y Windows (ARM64 y AMD64).
            </p>
          </div>
        </section>

        <div className="works-with">
          <div className="page-width works-inner">
            <p className="eyebrow">FUNCIONA CON</p>
            <ul>
              {works.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </div>

        <section
          className="example-section page-width"
          aria-labelledby="example-title"
        >
          <div className="section-heading section-heading-left">
            <p className="eyebrow eyebrow-blue">CÓDIGO ↔ ARQUITECTURA</p>
            <h2 id="example-title">Escribe en un lado. Míralo en el otro.</h2>
          </div>
          <EditorExample />
          <p className="mobile-scroll-hint">
            Desliza la muestra para explorar ambos paneles{" "}
            <ArrowRight size={13} aria-hidden="true" />
          </p>
        </section>

        <HowItWorks />
        <LocalDeploy />
        <Download />
        <Features />

        <section className="closing page-width" aria-labelledby="closing-title">
          <h2 id="closing-title">
            Abre tu carpeta <span>.tf</span>.
          </h2>
          <p>
            Prueba la demo en el navegador o descarga el binario. Código
            abierto, licencia MIT.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="./demo/">
              Abrir la demo <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="button button-secondary" href={repository}>
              Ver en GitHub <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="page-width footer-inner">
          <Brand />
          <p>Tu infraestructura, conectada con su código.</p>
          <nav aria-label="Enlaces del proyecto">
            <a href={repository}>
              GitHub <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            <a href={documentation}>
              Documentación <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            <a href={fontLicensesUrl}>Licencias de fuentes</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
