import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  FileCode2,
  FolderOpen,
  GitBranch,
  Layers3,
  LockKeyhole,
  Network,
  PencilLine,
} from "lucide-react";
import { EditorExample } from "./EditorExample";
import fontLicensesUrl from "./font-licenses.txt?url";

const repository = "https://github.com/RenzoAL7/TerraDock";
const documentation = `${repository}#readme`;

function Brand() {
  return (
    <a className="brand" href="#inicio" aria-label="TerraDock, inicio">
      <span className="brand-mark">
        <Layers3 size={23} aria-hidden="true" />
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
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#funciones">Funciones</a>
          <a href={documentation}>
            Documentación <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </nav>
        <button className="access-button" disabled>
          <LockKeyhole size={15} aria-hidden="true" />
          <span>
            Acceso <span className="coming-soon">Próximamente</span>
          </span>
        </button>
      </div>
    </header>
  );
}

const steps = [
  {
    icon: FolderOpen,
    title: "Abre tu Terraform",
    text: "En la aplicación local, elige una carpeta con archivos .tf. Tu configuración es el punto de partida.",
  },
  {
    icon: Network,
    title: "Encuentra las conexiones",
    text: "Explora los recursos declarados y sus referencias. Ve del diagrama al bloque de código que los define.",
  },
  {
    icon: PencilLine,
    title: "Edita con contexto",
    text: "Modifica el código o los valores literales compatibles y revisa cómo cambia su representación.",
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
          El recorrido de la demo local, desde el archivo hasta su arquitectura.
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

const currentFeatures = [
  {
    title: "Código y arquitectura conectados",
    text: "Recursos y referencias del módulo Terraform que abras en tu equipo.",
  },
  {
    title: "Edición local",
    text: "Código, propiedades literales compatibles y navegación al origen.",
  },
  {
    title: "Diagnósticos y revisión de cambios",
    text: "Errores de sintaxis y detección de conflictos al guardar archivos.",
  },
];

const plannedFeatures = [
  {
    title: "Cuentas y proyectos privados",
    text: "Acceso personal y espacios de trabajo persistentes en la web.",
  },
  {
    title: "Integración con GitHub",
    text: "Conectar repositorios y proponer cambios mediante pull requests.",
  },
  {
    title: "Plan, aprobación y apply",
    text: "Revisar y autorizar ejecuciones de Terraform para una revisión concreta.",
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
            La demo funciona en tu equipo. La aplicación web se construye por
            etapas.
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
                Próximamente en la web
              </span>
              <Layers3 size={21} aria-hidden="true" />
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
              Funciones previstas; todavía no están disponibles.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function LocalAppCallout() {
  return (
    <section className="local-callout page-width" aria-labelledby="local-title">
      <div>
        <p className="eyebrow">SIGUE EXPLORANDO</p>
        <h2 id="local-title">Lleva la claridad a tu propio código.</h2>
        <p>Consulta cómo probar la demo local de TerraDock en tu equipo.</p>
      </div>
      <a className="button button-dark" href={`${repository}#probar-la-demo`}>
        Ver guía de inicio <ArrowUpRight size={17} aria-hidden="true" />
      </a>
    </section>
  );
}

export function LandingPage() {
  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <div id="inicio">
        <Header />
      </div>
      <main id="contenido" tabIndex={-1}>
        <section className="hero page-width" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">TU INFRAESTRUCTURA, A LA VISTA.</p>
            <h1 id="hero-title">
              El código es tuyo.
              <br />
              La claridad,
              <br />
              <span>también.</span>
            </h1>
            <p className="hero-description">
              TerraDock conecta tu código Terraform con una vista de su
              arquitectura. Comprende los recursos, sigue sus relaciones y edita
              con contexto.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="./demo/">
                Probar demo <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a className="button button-secondary" href={repository}>
                <GitBranch size={17} aria-hidden="true" /> Ver en GitHub
              </a>
            </div>
            <p className="hero-note">
              <LockKeyhole size={13} aria-hidden="true" /> Prueba el editor con
              un ejemplo, sin cuenta ni credenciales cloud.
            </p>
            <div className="hero-details">
              <span>
                <FileCode2 size={16} aria-hidden="true" /> Terraform / HCL
              </span>
              <span className="detail-divider" />
              <span>Proyecto en desarrollo</span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="preview-label">
              <span>CÓDIGO + ARQUITECTURA</span>
              <span>Una misma configuración</span>
            </div>
            <EditorExample />
            <p className="mobile-scroll-hint">
              Desliza la muestra para explorar ambos paneles{" "}
              <ArrowRight size={13} aria-hidden="true" />
            </p>
          </div>
        </section>
        <div className="principles page-width">
          <p>Tu configuración, con más contexto.</p>
          <span>
            <Code2 size={17} aria-hidden="true" /> HCL legible
          </span>
          <span>
            <Network size={17} aria-hidden="true" /> Recursos conectados
          </span>
          <span>
            <FolderOpen size={17} aria-hidden="true" /> Archivos en tu equipo
          </span>
        </div>
        <HowItWorks />
        <Features />
        <LocalAppCallout />
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
    </>
  );
}
