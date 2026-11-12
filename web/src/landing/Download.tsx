import { useState } from "react";
import {
  ArrowUpRight,
  Download as DownloadIcon,
  Laptop,
  Monitor,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export const repository = "https://github.com/RenzoAL7/TerraDock";
const latest = `${repository}/releases/latest`;

type Platform = {
  id: "mac" | "windows" | "linux";
  name: string;
  icon: LucideIcon;
  files: { label: string; detail: string; file: string }[];
  hint: string;
};

const platforms: Platform[] = [
  {
    id: "mac",
    name: "macOS",
    icon: Laptop,
    files: [
      {
        label: "Apple Silicon",
        detail: "M1, M2, M3, M4…",
        file: "terradock_darwin_arm64.tar.gz",
      },
      {
        label: "Intel",
        detail: "Mac anteriores a 2021",
        file: "terradock_darwin_amd64.tar.gz",
      },
    ],
    hint: "¿Cuál tienes? Menú Apple → Acerca de esta Mac: «Chip Apple M…» es Apple Silicon.",
  },
  {
    id: "windows",
    name: "Windows",
    icon: Monitor,
    files: [
      {
        label: "x64",
        detail: "Casi todos los equipos",
        file: "terradock_windows_amd64.zip",
      },
      {
        label: "ARM",
        detail: "Snapdragon, Surface Pro X",
        file: "terradock_windows_arm64.zip",
      },
    ],
    hint: "Si no sabes cuál, elige x64.",
  },
  {
    id: "linux",
    name: "Linux",
    icon: SquareTerminal,
    files: [
      {
        label: "x64",
        detail: "amd64 / x86_64",
        file: "terradock_linux_amd64.tar.gz",
      },
      {
        label: "ARM64",
        detail: "aarch64, Raspberry Pi 4/5",
        file: "terradock_linux_arm64.tar.gz",
      },
    ],
    hint: "Compruébalo con uname -m: x86_64 es x64; aarch64 es ARM64.",
  },
];

function detectPlatform(): Platform["id"] | null {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(agent)) return "windows";
  if (/Mac OS X|Macintosh/i.test(agent) && !/iPhone|iPad/i.test(agent))
    return "mac";
  if (/Linux/i.test(agent) && !/Android/i.test(agent)) return "linux";
  return null;
}

const needs = [
  {
    what: "Probarlo sin instalar nada",
    need: "Solo tu navegador.",
    link: { href: "./demo/", label: "Abrir la demo" },
  },
  {
    what: "Ver y editar tu Terraform",
    need: "Solo el archivo de TerraDock. No pide cuenta ni credenciales.",
  },
  {
    what: "Desplegar en un AWS simulado (opcional)",
    need: "Además: Docker, la CLI de Floci y Terraform u OpenTofu.",
    link: { href: "https://floci.io", label: "Instalar Floci" },
  },
];

export function Download() {
  const [current] = useState(detectPlatform);
  return (
    <section
      className="download-section page-width"
      id="descargar"
      aria-labelledby="download-title"
      tabIndex={-1}
    >
      <div className="section-heading">
        <p className="eyebrow">DESCARGAR</p>
        <h2 id="download-title">Un solo archivo. Sin instalar nada más.</h2>
        <p>
          TerraDock corre en tu equipo y se abre en tu navegador. Tus archivos
          no salen de tu máquina.
        </p>
      </div>
      <div className="platforms">
        {platforms.map(({ id, name, icon: Icon, files, hint }) => (
          <article
            className={`platform${id === current ? " platform-current" : ""}`}
            key={id}
            aria-labelledby={`platform-${id}`}
          >
            <div className="platform-heading">
              <Icon size={20} aria-hidden="true" />
              <h3 id={`platform-${id}`}>{name}</h3>
              {id === current && (
                <span className="platform-badge">Tu sistema</span>
              )}
            </div>
            <ul>
              {files.map(({ label, detail, file }) => (
                <li key={file}>
                  <a
                    className="download-link"
                    href={`${latest}/download/${file}`}
                    aria-label={`Descargar para ${name} ${label}`}
                  >
                    <DownloadIcon size={16} aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="platform-hint">{hint}</p>
          </article>
        ))}
      </div>

      <div className="after-download">
        <h3>Después de descargar</h3>
        <ol>
          <li>
            <strong>Descomprime el archivo.</strong> Dentro está el programa{" "}
            <code>terradock</code> (<code>terradock.exe</code> en Windows).
          </li>
          <li>
            <strong>Ábrelo desde la carpeta de tus proyectos.</strong> En una
            terminal, entra en la carpeta con tus archivos <code>.tf</code> y
            ejecuta <code>/ruta/a/terradock</code>. Solo podrá abrir esa carpeta
            y lo que contiene.
          </li>
          <li>
            <strong>Usa el navegador.</strong> Se abre solo en{" "}
            <code>http://127.0.0.1:7331</code>. Pulsa «Abrir carpeta», elige un
            proyecto y edita en el código o en el diagrama. Para cerrarlo, pulsa{" "}
            <code>Ctrl+C</code> en la terminal.
          </li>
        </ol>
        <p className="first-run">
          <strong>Primera vez:</strong> macOS puede decir que no se verifica al
          desarrollador; ejecuta{" "}
          <code>xattr -d com.apple.quarantine terradock</code>. En Windows, si
          aparece SmartScreen, pulsa «Más información» → «Ejecutar de todas
          formas».
        </p>
      </div>

      <div className="needs">
        <h3>¿Qué necesitas?</h3>
        <dl>
          {needs.map(({ what, need, link }) => (
            <div key={what}>
              <dt>{what}</dt>
              <dd>
                {need}{" "}
                {link && (
                  <a className="text-link" href={link.href}>
                    {link.label} <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <a className="text-link" href={latest}>
          Todas las versiones y sumas de verificación{" "}
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
