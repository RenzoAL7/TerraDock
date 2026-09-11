import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  Download,
  FileCode2,
  FolderOpen,
  GitBranch,
  Layers3,
  LayoutPanelLeft,
  Menu,
  Network,
  PanelLeftClose,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useWorkspace } from "./useWorkspace";
import { afterFileSave, afterPropertySave } from "./drafts";
import {
  ArchitectureCanvas,
  ResourceIcon,
} from "../features/architecture/ArchitectureCanvas";
import {
  Inspector,
  parsePropertyInput,
  propertyKey,
  type PropertyDraft,
} from "../features/inspector/Inspector";
import { FolderPicker } from "../features/project/FolderPicker";
import { Dialog } from "../components/Dialog";
import { api, errorMessage } from "../lib/api";
import type { Draft, Project, Property, Resource } from "../lib/types";

const CodeEditor = lazy(() => import("../features/editor/CodeEditor"));
type View = "architecture" | "code" | "split" | "analysis";
function without<T>(items: Record<string, T>, key: string) {
  const next = { ...items };
  delete next[key];
  return next;
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const { project, session, error, setError, busy, connected, perform } =
    useWorkspace();
  const [view, setView] = useState<View>("architecture");
  const [selected, setSelected] = useState(() =>
    window.matchMedia("(min-width: 901px)").matches ? "aws_instance.app_a" : "",
  );
  const [filePath, setFilePath] = useState("main.tf");
  const [line, setLine] = useState(1);
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState(
    () => window.matchMedia("(min-width: 901px)").matches,
  );
  const [folder, setFolder] = useState(false),
    [examples, setExamples] = useState(false),
    [help, setHelp] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [properties, setProperties] = useState<Record<string, PropertyDraft>>(
    {},
  );
  const [pending, setPending] = useState<(() => void) | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const hasUnsaved =
    Object.keys(drafts).length > 0 || Object.keys(properties).length > 0;
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (hasUnsaved) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSidebar(true);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("keydown", key);
    };
  }, [hasUnsaved]);

  if (!project || !session)
    return (
      <div className="startup">
        <div className="brand-mark">
          <Layers3 />
        </div>
        <h1>TerraDock</h1>
        <p>{error || "Preparando tu espacio de infraestructura…"}</p>
        {error && (
          <button
            className="button-primary"
            onClick={() => window.location.reload()}
          >
            Reintentar conexión
          </button>
        )}
      </div>
    );
  const resource = project.resources.find((r) => r.id === selected);
  const file =
    project.files.find((f) => f.path === filePath) ?? project.files[0];
  const draft = file && drafts[file.path];
  const conflict =
    draft &&
    (draft.projectId !== project.id || draft.baseRevision !== file.revision);
  const orphanDrafts = Object.entries(drafts).filter(
    ([path, d]) =>
      d.projectId !== project.id || !project.files.some((f) => f.path === path),
  );
  const staleProperties = Object.entries(properties).some(
    ([key, p]) =>
      p.projectId !== project.id ||
      !project.resources.some((r) =>
        r.properties.some(
          (prop) => prop.editable && propertyKey(r, prop) === key,
        ),
      ),
  );
  const issues = project.diagnostics.length + project.findings.length;
  const visibleResources = project.resources.filter((r) =>
    `${r.id} ${r.label} ${r.file}`.toLowerCase().includes(query.toLowerCase()),
  );
  const code = (path: string, targetLine = 1) => {
    setFilePath(path);
    setLine(targetLine);
    setView("code");
  };
  const switchWorkspace = (action: () => void) => {
    if (hasUnsaved) setPending(() => action);
    else action();
  };
  const adopt = (next: Project) => {
    setDrafts({});
    setProperties({});
    setSelected(
      next.resources.find((r) => r.type === "aws_instance")?.id ??
        next.resources[0]?.id ??
        "",
    );
    setFilePath(
      next.files.find((f) => f.path === "main.tf")?.path ??
        next.files[0]?.path ??
        "",
    );
    setQuery("");
    setView("architecture");
  };
  const template = async (name: string) => {
    const next = await perform(() => api.demo(name));
    if (next) {
      adopt(next);
      setExamples(false);
    }
  };
  const saveFile = async () => {
    if (!file || !draft || busy || conflict) return;
    const path = file.path,
      captured = draft;
    const next = await perform(() =>
      api.save(
        captured.projectId,
        path,
        captured.content,
        captured.baseRevision,
      ),
    );
    if (next)
      setDrafts((current) => afterFileSave(current, path, captured, next));
  };
  const saveProperty = async (
    target: Resource,
    property: Property,
    captured: PropertyDraft,
  ) => {
    try {
      const value = parsePropertyInput(property, captured.text);
      const next = await perform(() =>
        api.property(
          captured.projectId,
          target.id,
          property.name,
          value,
          captured.revision,
        ),
      );
      if (next)
        setProperties((current) =>
          afterPropertySave(current, target, property, captured, project, next),
        );
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };
  const editor = (
    <div className="editor-pane">
      <div className="file-tabs">
        {project.files.map((f) => (
          <button
            key={f.path}
            className={file?.path === f.path ? "active" : ""}
            onClick={() => {
              setFilePath(f.path);
              setLine(1);
            }}
          >
            <FileCode2 size={14} />
            {f.path}
            {drafts[f.path] && <i className="draft-dot" />}
          </button>
        ))}
      </div>
      {file ? (
        <>
          <div className="editor-toolbar">
            <span>
              {draft ? "Borrador sin guardar" : "Archivo sincronizado"}
            </span>
            <div>
              <button
                aria-label="Descargar archivo"
                title="Descargar archivo"
                onClick={() =>
                  download(file.path, draft?.content ?? file.content)
                }
              >
                <Download size={14} />
              </button>
              {draft && (
                <button
                  onClick={() =>
                    setDrafts((current) => without(current, file.path))
                  }
                >
                  Descartar borrador
                </button>
              )}
              <button
                className="save-file"
                disabled={!draft || busy || !!conflict}
                onClick={() => void saveFile()}
              >
                <Check size={14} />
                Guardar archivo
              </button>
            </div>
          </div>
          {conflict && (
            <div className="conflict-banner" role="alert">
              Hay una versión nueva del archivo o cambió el proyecto. Tu
              borrador se conserva. Descárgalo antes de descartarlo para cargar
              la versión actual.
            </div>
          )}
          <div className="editor-content">
            <Suspense
              fallback={<div className="editor-loading">Cargando editor…</div>}
            >
              <CodeEditor
                key={`${project.id}:${file.path}`}
                path={`${project.id}/${file.path}`}
                value={draft?.content ?? file.content}
                line={line}
                diagnostics={project.diagnostics.map((d) => ({
                  ...d,
                  file: `${project.id}/${d.file}`,
                }))}
                onSave={() => void saveFile()}
                onChange={(content) =>
                  setDrafts((current) =>
                    content === file.content
                      ? without(current, file.path)
                      : {
                          ...current,
                          [file.path]: {
                            content,
                            baseRevision:
                              current[file.path]?.baseRevision ?? file.revision,
                            projectId:
                              current[file.path]?.projectId ?? project.id,
                          },
                        },
                  )
                }
              />
            </Suspense>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <FileCode2 />
          <h2>No hay archivos .tf</h2>
          <p>Selecciona una carpeta con un módulo Terraform.</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Layers3 size={22} />
          </span>
          <strong>TerraDock</strong>
          <span className="brand-version">preview</span>
        </div>
        <div className="top-divider" />
        <span className="top-project">
          <FolderOpen size={15} />
          {project.name}
        </span>
        <span className="local-badge">
          <span />
          {project.mode === "demo" ? "Ejemplo · en memoria" : "Carpeta local"}
        </span>
        <div className="top-actions">
          <button onClick={() => setExamples(true)}>
            <BookOpen size={15} />
            <span>Ejemplos</span>
          </button>
          <button
            className="open-folder"
            onClick={() => switchWorkspace(() => setFolder(true))}
          >
            <FolderOpen size={16} />
            Abrir carpeta
          </button>
          <button
            className="icon-button"
            aria-label="Ayuda"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={19} />
          </button>
        </div>
      </header>
      <div className="workspace-toolbar">
        <button
          className="icon-button sidebar-toggle"
          aria-label={sidebar ? "Ocultar explorador" : "Mostrar explorador"}
          onClick={() => setSidebar(!sidebar)}
        >
          {sidebar ? <PanelLeftClose size={18} /> : <Menu size={18} />}
        </button>
        <div className="breadcrumbs">
          <span>Workspace</span>
          <ChevronRight size={13} />
          <strong>
            {project.mode === "demo"
              ? "AWS · aplicación de ejemplo"
              : project.name}
          </strong>
        </div>
        <nav className="view-tabs" aria-label="Vista del proyecto">
          {(
            [
              { id: "architecture", label: "Arquitectura", icon: Network },
              { id: "code", label: "Código", icon: Code2 },
              { id: "split", label: "Dividir vista", icon: LayoutPanelLeft },
              { id: "analysis", label: "Análisis", icon: ShieldCheck },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              className={view === v.id ? "active" : ""}
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              <v.icon size={15} />
              <span>{v.label}</span>
              {v.id === "analysis" && issues > 0 && <small>{issues}</small>}
            </button>
          ))}
        </nav>
      </div>
      {error && !folder && (
        <div className="global-message" role="alert">
          <TriangleAlert size={16} />
          <span>{error}</span>
          <button aria-label="Cerrar aviso" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {(orphanDrafts.length > 0 || staleProperties) && (
        <div className="global-message">
          <TriangleAlert size={16} />
          <span>
            Cambió el proyecto o desapareció un recurso. Conservamos los
            borradores anteriores.
          </span>
          {orphanDrafts.map(([path, d]) => (
            <button key={path} onClick={() => download(path, d.content)}>
              Descargar {path}
            </button>
          ))}
          {staleProperties && (
            <button
              onClick={() =>
                download(
                  "terradock-property-drafts.json",
                  JSON.stringify(properties, null, 2),
                )
              }
            >
              Descargar propiedades
            </button>
          )}
          <button
            onClick={() => {
              setDrafts({});
              setProperties({});
            }}
          >
            Descartar borradores
          </button>
        </div>
      )}
      <div
        className={`workspace ${sidebar ? "" : "sidebar-hidden"} ${resource && view !== "code" && view !== "analysis" ? "with-inspector" : ""}`}
      >
        {sidebar && (
          <aside className="explorer">
            <div className="panel-heading">
              <span>EXPLORADOR</span>
              <span className="count-badge">{project.resources.length}</span>
            </div>
            <div className="search-field">
              <Search size={15} />
              <input
                ref={searchRef}
                aria-label="Buscar recursos"
                placeholder="Buscar recursos…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </div>
            <div className="explorer-project">
              <ChevronRight size={13} />
              <FolderOpen size={16} />
              <strong>{project.name}</strong>
            </div>
            <div className="explorer-scroll">
              <div className="section-caption">
                RECURSOS <span>{visibleResources.length}</span>
              </div>
              {visibleResources.map((r) => (
                <button
                  data-testid={`resource-${r.id}`}
                  key={r.id}
                  className={`explorer-resource ${selected === r.id ? "active" : ""}`}
                  title={r.id}
                  onClick={() => {
                    setSelected(r.id);
                    if (view === "code" || view === "analysis")
                      setView("architecture");
                  }}
                >
                  <span className={`tree-icon ${r.category}`}>
                    <ResourceIcon resource={r} size={17} />
                  </span>
                  <span>
                    <strong>{r.label || r.name}</strong>
                    <small>{r.type.replace("aws_", "")}</small>
                  </span>
                  {selected === r.id && <i />}
                </button>
              ))}
              {!visibleResources.length && (
                <p className="search-empty">No se encontraron recursos.</p>
              )}
              <div className="section-caption files-caption">
                ARCHIVOS <span>{project.files.length}</span>
              </div>
              {project.files.map((f) => (
                <button
                  className="explorer-file"
                  key={f.path}
                  onClick={() => code(f.path)}
                >
                  <FileCode2 size={15} />
                  <span>{f.path}</span>
                  {drafts[f.path] && <i className="draft-dot" />}
                </button>
              ))}
            </div>
            <div className="explorer-foot">
              <ShieldCheck size={17} />
              <div>
                <strong>Tu infraestructura, en tu equipo</strong>
                <span>Sin cuentas. Sin subir archivos.</span>
              </div>
            </div>
          </aside>
        )}
        <main className={`main-panel view-${view}`}>
          {view !== "code" && (
            <div className="canvas-heading">
              <div>
                <span className="eyebrow">
                  {view === "analysis"
                    ? "LECTURA ESTÁTICA"
                    : "MAPA DE INFRAESTRUCTURA"}
                </span>
                <h1>
                  {view === "analysis"
                    ? "Entiende lo que declaraste"
                    : project.mode === "demo"
                      ? "Una vista de tu arquitectura"
                      : project.name}
                </h1>
                <p>
                  {view === "analysis"
                    ? "Hallazgos con evidencia en tus archivos Terraform."
                    : "Explora las conexiones. Selecciona un recurso para ver sus propiedades."}
                </p>
              </div>
              <span
                className={`syntax-status ${project.valid ? "" : "invalid"}`}
              >
                {project.valid ? (
                  <Check size={14} />
                ) : (
                  <TriangleAlert size={14} />
                )}
                {project.valid ? "HCL válido" : "Revisar HCL"}
              </span>
            </div>
          )}
          {!project.valid && view !== "analysis" && (
            <button
              className="syntax-banner"
              onClick={() => setView("analysis")}
            >
              <TriangleAlert size={15} /> El gráfico conserva la última
              configuración válida. Ver errores <ArrowUpRight size={14} />
            </button>
          )}
          <div
            className={`view-content ${view === "split" ? "split-content" : ""}`}
          >
            {(view === "architecture" || view === "split") && (
              <ArchitectureCanvas
                resources={project.resources}
                edges={project.edges}
                selected={selected}
                query={query}
                onSelect={setSelected}
                resetKey={`${project.id}:${view}`}
              />
            )}
            {(view === "code" || view === "split") && editor}
            {view === "analysis" && (
              <div className="analysis-content">
                <div className="analysis-summary">
                  <div>
                    <span>{project.resources.length}</span>
                    <p>Recursos declarados</p>
                  </div>
                  <div>
                    <span>{project.edges.length}</span>
                    <p>Referencias detectadas</p>
                  </div>
                  <div>
                    <span>
                      {
                        project.diagnostics.filter(
                          (d) => d.severity === "error",
                        ).length
                      }
                    </span>
                    <p>Errores de sintaxis</p>
                  </div>
                  <div>
                    <span>{project.findings.length}</span>
                    <p>Hallazgos estáticos</p>
                  </div>
                </div>
                <p className="analysis-note">
                  Se revisan sintaxis, referencias directas, CIDR de subredes y
                  reglas SSH literales. Esto no verifica el estado desplegado ni
                  reemplaza una auditoría de seguridad.
                </p>
                {project.diagnostics.map((d, i) => (
                  <article
                    className={`finding ${d.severity}`}
                    key={`${d.file}:${i}`}
                  >
                    <TriangleAlert size={21} />
                    <div>
                      <span className="eyebrow">
                        {d.severity === "error"
                          ? "ERROR DE HCL"
                          : "ALCANCE DEL ANÁLISIS"}
                      </span>
                      <h3>{d.message}</h3>
                      <button
                        className="text-link"
                        onClick={() => code(d.file, d.line)}
                      >
                        {d.file}:{d.line}
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
                {project.findings.map((f) => (
                  <article className="finding warning" key={f.id}>
                    <ShieldCheck size={22} />
                    <div>
                      <span className="eyebrow">
                        {f.severity === "warning"
                          ? "REVISAR CONFIGURACIÓN"
                          : "INFORMACIÓN"}
                      </span>
                      <h3>{f.title}</h3>
                      <p>{f.detail}</p>
                      <button
                        className="text-link"
                        onClick={() => code(f.file, f.line)}
                      >
                        {f.file}:{f.line}
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
                {!issues && (
                  <div className="empty-state">
                    <ShieldCheck size={35} />
                    <h2>Sin hallazgos en las reglas disponibles</h2>
                    <p>
                      La configuración pasó las comprobaciones estáticas de esta
                      demo.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
        {resource && (view === "architecture" || view === "split") && (
          <Inspector
            resource={resource}
            project={project}
            drafts={properties}
            fileDirty={!!drafts[resource.file]}
            busy={busy}
            onDraft={(key, next) =>
              setProperties((current) =>
                next ? { ...current, [key]: next } : without(current, key),
              )
            }
            onSave={saveProperty}
            onCode={code}
            onSelect={setSelected}
            onClose={() => setSelected("")}
          />
        )}
      </div>
      <footer className="statusbar">
        <span className={`connection-state ${connected ? "connected" : ""}`}>
          <i />
          {connected ? "Servidor local conectado" : "Reconectando al servidor…"}
        </span>
        <span className="footer-project">
          <GitBranch size={12} />
          {project.mode === "demo" ? "Ejemplo editable" : "Archivos locales"}
        </span>
        <span className="status-spacer" />
        <span>
          {hasUnsaved ? "Cambios sin guardar" : "Sin cambios pendientes"}
        </span>
        <span>{project.resources.length} recursos</span>
        <span>{project.files.length} archivos</span>
        <span className="hcl-status">
          HCL <Activity size={12} />
        </span>
      </footer>
      {folder && (
        <FolderPicker
          root={session.root}
          busy={busy}
          error={error}
          onClose={() => {
            if (busy) return;
            setFolder(false);
            setError("");
          }}
          onOpen={async (path) => {
            const next = await perform(() => api.open(path));
            if (next) {
              adopt(next);
              setFolder(false);
            }
          }}
        />
      )}
      {examples && (
        <Dialog
          title="Explorar un ejemplo"
          onClose={() => {
            if (!busy) setExamples(false);
          }}
        >
          <p className="dialog-intro">
            Configuraciones de muestra para descubrir TerraDock. Puedes
            editarlas en memoria y descargar sus archivos.
          </p>
          <div className="template-list">
            <button
              disabled={busy}
              onClick={() => switchWorkspace(() => void template("web-app"))}
            >
              <Network size={25} />
              <span>
                <strong>Aplicación web AWS</strong>
                <small>VPC, subredes, cómputo, balanceador y datos.</small>
              </span>
              <ArrowUpRight size={18} />
            </button>
            <button
              disabled={busy}
              onClick={() => switchWorkspace(() => void template("basic-vpc"))}
            >
              <Layers3 size={25} />
              <span>
                <strong>Red mínima AWS</strong>
                <small>Un punto de partida con tres recursos.</small>
              </span>
              <ArrowUpRight size={18} />
            </button>
          </div>
          <p className="root-note">
            Los ejemplos ilustran el análisis; no son plantillas verificadas
            para desplegar.
          </p>
        </Dialog>
      )}
      {help && (
        <Dialog
          title="Tu workspace de Terraform"
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <p>
              TerraDock lee los archivos <code>.tf</code> de una carpeta y
              convierte las declaraciones en un mapa navegable.
            </p>
            <ol>
              <li>
                <strong>Explora</strong> el ejemplo o abre una carpeta dentro de
                la raíz permitida.
              </li>
              <li>
                <strong>Selecciona un recurso</strong> para editar literales
                compatibles. Las expresiones se conservan en el editor.
              </li>
              <li>
                <strong>Guarda el código</strong> con el botón o ⌘/Ctrl + S. Los
                cambios externos se detectan automáticamente.
              </li>
            </ol>
            <p>
              Todo se sirve desde tu equipo. Esta preview no ejecuta Terraform
              ni contacta proveedores cloud. Los módulos se muestran sin
              expandir y <code>count</code>/<code>for_each</code> no se evalúan.
            </p>
            <p className="root-note">
              Una instancia del servidor comparte el proyecto entre sus
              pestañas. Los borradores quedan en cada pestaña hasta guardar o
              cerrar.
            </p>
          </div>
        </Dialog>
      )}
      {pending && (
        <Dialog
          title="Hay cambios sin guardar"
          onClose={() => setPending(null)}
        >
          <p className="dialog-intro">
            Cambiar de proyecto descartará tus borradores. Si quieres
            conservarlos, vuelve al editor y guárdalos o descárgalos primero.
          </p>
          <div className="dialog-footer">
            <button
              className="button-secondary"
              onClick={() => setPending(null)}
            >
              Seguir editando
            </button>
            <button
              className="button-primary"
              onClick={() => {
                const action = pending;
                setPending(null);
                action();
              }}
            >
              Descartar y continuar
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
