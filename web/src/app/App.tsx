import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
  History,
  Layers3,
  LayoutPanelLeft,
  Menu,
  Network,
  PanelLeftClose,
  RadioTower,
  Rocket,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useOtherTabDrafts, useWorkspace } from "./useWorkspace";
import { afterFileSave, settledProperties, withDraft } from "./drafts";
import { useLivePreview } from "./useLivePreview";
import { useDraftRecovery } from "./useDraftRecovery";
import type { StoredDraft } from "./draftStore";
import { declarationEnd, resourceAtLine } from "./blocks";
import { DeployPanel } from "../features/deploy/DeployPanel";
import { deployMarks, useFloci } from "../features/deploy/useFloci";
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
import type { DiskBasis } from "../features/editor/ConflictDiff";
import { Dialog } from "../components/Dialog";
import { api, errorMessage, liveApi } from "../lib/api";
import type { Draft, Project, Property, Resource } from "../lib/types";

const CodeEditor = lazy(() => import("../features/editor/CodeEditor"));
// Only loaded when a file changed on disk under a draft.
const ConflictDiff = lazy(() => import("../features/editor/ConflictDiff"));
type View = "architecture" | "code" | "split" | "analysis" | "deploy";
const AUTOSAVE_KEY = "terradock.autosave";
const AUTOSAVE_DELAY = 600;
function readAutosave() {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== "off";
  } catch {
    return true;
  }
}
/** First resource worth showing: an instance when there is one. */
function defaultSelection(project: Project) {
  return (
    project.resources.find((r) => r.type === "aws_instance")?.id ??
    project.resources[0]?.id ??
    ""
  );
}
const relativeTime = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
/** "hace 5 minutos", "ayer"… for a past timestamp. */
function ago(timestamp: number) {
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  if (minutes > -60) return relativeTime.format(Math.min(minutes, 0), "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}
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
  const [selected, setSelected] = useState("");
  const [filePath, setFilePath] = useState("main.tf");
  const [line, setLine] = useState(1);
  // Nonces: re-reveal in the editor / re-center in the canvas even when the
  // same resource or line is chosen again.
  const [reveal, setReveal] = useState(0);
  const [focus, setFocus] = useState({ id: "", n: 0 });
  const focusOn = (id: string) => setFocus((f) => ({ id, n: f.n + 1 }));
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
  const [cleared, setCleared] = useState("");
  const [autosave, setAutosave] = useState(readAutosave);
  const searchRef = useRef<HTMLInputElement>(null);
  const hasUnsaved =
    Object.keys(drafts).length > 0 || Object.keys(properties).length > 0;
  // Saved files + unsaved drafts, re-analyzed as you type.
  const urgentPreview = useRef(false);
  const live = useLivePreview(project, drafts, 60, urgentPreview);
  const floci = useFloci(project?.id, project?.revision, view === "deploy");
  // Drafts survive closing or reloading the tab (browser profile, 7 days).
  const recovery = useDraftRecovery(session, project, drafts);
  const otherTabs = useOtherTabDrafts(session, project, drafts);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const projectRef = useRef(project);
  projectRef.current = project;
  const applyQueue = useRef(Promise.resolve(""));
  const savingRef = useRef(false);
  // Our own save reaches this tab over SSE before its HTTP response; until
  // then the draft looks based on an old revision but is not a conflict.
  const [savingPath, setSavingPath] = useState("");

  const saveDraft = useCallback(
    async (path: string) => {
      const current = projectRef.current;
      const captured = draftsRef.current[path];
      const file = current?.files.find((f) => f.path === path);
      if (!current || !captured || !file || savingRef.current) return;
      if (
        captured.projectId !== current.id ||
        captured.baseRevision !== file.revision
      )
        return;
      savingRef.current = true;
      setSavingPath(path);
      try {
        const next = await perform(() =>
          api.save(
            captured.projectId,
            path,
            captured.content,
            captured.baseRevision,
          ),
        );
        if (next)
          setDrafts((latest) => afterFileSave(latest, path, captured, next));
      } finally {
        savingRef.current = false;
        setSavingPath("");
      }
    },
    [perform],
  );

  // Graph → code: apply an inspector value to the file draft immediately.
  const applyProperty = useCallback(
    (target: Resource, property: Property, text: string) => {
      const job = applyQueue.current.then(async () => {
        const current = projectRef.current;
        const file = current?.files.find((f) => f.path === target.file);
        if (!current || !file) return "El archivo ya no está disponible.";
        let value: string | number | boolean;
        try {
          value = parsePropertyInput(property, text);
        } catch (reason) {
          return errorMessage(reason);
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          const base = draftsRef.current[file.path];
          const content =
            base?.projectId === current.id ? base.content : file.content;
          try {
            const result = await liveApi.editDraft(
              current.id,
              file.path,
              content,
              target.id,
              property.name,
              value,
            );
            const latest = draftsRef.current[file.path];
            const latestContent =
              latest?.projectId === current.id ? latest.content : file.content;
            // Typing in the editor during the request: retry on fresh text.
            if (latestContent !== content) continue;
            const next = withDraft(
              draftsRef.current,
              file.path,
              result.content,
              file,
              current.id,
            );
            draftsRef.current = next;
            urgentPreview.current = true;
            setDrafts(next);
            return "";
          } catch (reason) {
            return errorMessage(reason);
          }
        }
        return "El código cambió mientras se aplicaba. Vuelve a intentarlo.";
      });
      applyQueue.current = job.catch(() => "");
      return job;
    },
    [],
  );

  // On wide screens, select a resource of whatever project the server opened.
  const initialSelection = useRef(false);
  useEffect(() => {
    if (!project || initialSelection.current) return;
    initialSelection.current = true;
    if (window.matchMedia("(min-width: 901px)").matches)
      setSelected((current) => current || defaultSelection(project));
  }, [project]);

  // Inspector text is dropped once the live view reflects it.
  useEffect(() => {
    if (!project || !live || live.pending) return;
    setProperties((current) =>
      settledProperties(current, live.resources, project.id),
    );
  }, [project, live]);

  // Code → disk: autosave valid drafts shortly after typing stops.
  const autosaveTarget =
    autosave && project && live && live.live && live.valid && !live.pending
      ? Object.entries(drafts).find(
          ([path, d]) =>
            d.projectId === project.id &&
            project.files.find((f) => f.path === path)?.revision ===
              d.baseRevision,
        )?.[0]
      : undefined;
  useEffect(() => {
    if (!autosaveTarget || busy || !connected) return;
    const timer = window.setTimeout(
      () => void saveDraft(autosaveTarget),
      AUTOSAVE_DELAY,
    );
    return () => clearTimeout(timer);
  }, [autosaveTarget, drafts, busy, connected, saveDraft]);
  const toggleAutosave = () =>
    setAutosave((current) => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, current ? "off" : "on");
      } catch {
        /* preference is optional */
      }
      return !current;
    });
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

  if (!project || !session || !live)
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
  const resource = live.resources.find((r) => r.id === selected);
  const file =
    project.files.find((f) => f.path === filePath) ?? project.files[0];
  const draft = file && drafts[file.path];
  const projectConflict = !!draft && draft.projectId !== project.id;
  // The file changed on disk under the draft: compare instead of editing.
  const revisionConflict =
    !!draft &&
    !projectConflict &&
    draft.baseRevision !== file.revision &&
    savingPath !== file.path;
  const conflict = projectConflict || revisionConflict;
  const orphanDrafts = Object.entries(drafts).filter(
    ([path, d]) =>
      d.projectId !== project.id || !project.files.some((f) => f.path === path),
  );
  const staleProperties = Object.entries(properties).some(
    ([key, p]) =>
      p.projectId !== project.id ||
      !live.resources.some((r) =>
        r.properties.some(
          (prop) => prop.editable && propertyKey(r, prop) === key,
        ),
      ),
  );
  const issues = live.diagnostics.length + live.findings.length;
  const marks = deployMarks(
    floci.status,
    { projectId: project.id, revision: project.revision },
    floci.read,
    live.resources,
  );
  const editorContent = file ? (draft?.content ?? file.content) : "";
  // Listed so their warning is visible; their content is not interpreted.
  const readOnlyFile = !!file && file.path.endsWith(".tf.json");
  const linked =
    resource && file && resource.file === file.path
      ? { start: resource.line, end: declarationEnd(resource, editorContent) }
      : null;
  const conflictCount = Object.entries(drafts).filter(([path, d]) => {
    const f = project.files.find((x) => x.path === path);
    return f && d.projectId === project.id && d.baseRevision !== f.revision;
  }).length;
  const syncNote = conflictCount
    ? "Conflicto: el archivo cambió fuera de TerraDock."
    : !live.valid && live.live
      ? "HCL con errores: el diagrama espera una versión válida."
      : live.pending
        ? "Actualizando diagrama…"
        : hasUnsaved
          ? autosave
            ? "Cambios en vivo · se guardan automáticamente"
            : "Cambios en vivo · ⌘/Ctrl + S para guardar"
          : "Sincronizado con el archivo";
  const selectResource = (id: string, fromCanvas = false) => {
    setSelected(id);
    if (!fromCanvas) focusOn(id);
    const target = live.resources.find((r) => r.id === id);
    // Graph → code: in split view, follow the selected node in the editor.
    if (target && view === "split") {
      setFilePath(target.file);
      setLine(target.line);
      setReveal((n) => n + 1);
    }
  };
  const visibleResources = live.resources.filter((r) =>
    `${r.id} ${r.label} ${r.file}`.toLowerCase().includes(query.toLowerCase()),
  );
  const code = (path: string, targetLine = 1) => {
    setFilePath(path);
    setLine(targetLine);
    setReveal((n) => n + 1);
    setView("code");
  };
  const restoreDraft = (entry: StoredDraft) => {
    const restored = recovery.restore(entry);
    if (!restored) return;
    const next = { ...draftsRef.current, [entry.file]: restored };
    draftsRef.current = next;
    urgentPreview.current = true;
    setDrafts(next);
    code(entry.file);
  };
  const discardDraft = (path: string) => {
    const next = without(draftsRef.current, path);
    draftsRef.current = next;
    setDrafts(next);
    // Inspector text for this file belonged to the discarded draft.
    const inFile = new Set(
      live.resources.filter((r) => r.file === path).map((r) => r.id),
    );
    setProperties((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !inFile.has(key.split(":")[0]),
        ),
      ),
    );
  };
  /**
   * Put a draft on top of the disk version it was resolved against, and
   * optionally save it. If the file changed again since (`basis` is older
   * than the file), the draft stays in conflict with the newer version.
   */
  const rebaseDraft = (
    path: string,
    content: string,
    save: boolean,
    basis: DiskBasis,
  ) => {
    if (!project.files.some((f) => f.path === path)) return;
    const next = { ...draftsRef.current };
    if (content === basis.content) delete next[path];
    else
      next[path] = {
        projectId: project.id,
        content,
        baseRevision: basis.revision,
        baseContent: basis.content,
      };
    draftsRef.current = next;
    urgentPreview.current = true;
    setDrafts(next);
    if (save && next[path]) void saveDraft(path);
  };
  const switchWorkspace = (action: () => void) => {
    if (hasUnsaved) setPending(() => action);
    else action();
  };
  const adopt = (next: Project) => {
    setDrafts({});
    setProperties({});
    setSelected(defaultSelection(next));
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
  const saveFile = () => {
    if (file && draft && !conflict) void saveDraft(file.path);
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
            <span className="sync-state">
              <RadioTower size={11} />
              {readOnlyFile
                ? "Solo lectura · TerraDock no interpreta .tf.json"
                : draft
                  ? autosave && !conflict
                    ? live.valid
                      ? "En vivo · guardando automáticamente"
                      : "En vivo · autoguardado en pausa (HCL con errores)"
                    : "En vivo · sin guardar"
                  : "Archivo sincronizado"}
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
                <button onClick={() => discardDraft(file.path)}>
                  Descartar borrador
                </button>
              )}
              <label className="autosave-toggle">
                <input
                  type="checkbox"
                  checked={autosave}
                  onChange={toggleAutosave}
                />
                Autoguardado
              </label>
              <button
                className="save-file"
                disabled={!draft || busy || !!conflict}
                onClick={saveFile}
              >
                <Check size={14} />
                Guardar archivo
              </button>
            </div>
          </div>
          {otherTabs.has(file.path) && (
            <div className="conflict-banner" role="status">
              Otra pestaña tiene un borrador sin guardar de {file.path}. Si
              también lo editas aquí, se guardará primero el que llegue antes y
              el otro tendrá que compararse con el disco.
            </div>
          )}
          {projectConflict && (
            <div className="conflict-banner" role="alert">
              Cambió el proyecto abierto. Tu borrador se conserva: descárgalo
              antes de descartarlo para cargar la versión actual.
            </div>
          )}
          <div className="editor-content">
            <Suspense
              fallback={<div className="editor-loading">Cargando editor…</div>}
            >
              {revisionConflict ? (
                <ConflictDiff
                  key={`${project.id}:${file.path}:${draft.baseRevision}`}
                  file={file.path}
                  base={draft.baseContent}
                  mine={draft.content}
                  disk={file.content}
                  diskRevision={file.revision}
                  onKeepMine={(text, basis) =>
                    rebaseDraft(file.path, text, true, basis)
                  }
                  onUseDisk={() => discardDraft(file.path)}
                  onApply={(text, basis) =>
                    rebaseDraft(file.path, text, false, basis)
                  }
                />
              ) : (
                <CodeEditor
                  key={`${project.id}:${file.path}`}
                  path={`${project.id}/${file.path}`}
                  readOnly={readOnlyFile}
                  value={editorContent}
                  line={line}
                  revealKey={reveal}
                  highlight={linked}
                  diagnostics={live.diagnostics.map((d) => ({
                    ...d,
                    file: `${project.id}/${d.file}`,
                  }))}
                  onSave={saveFile}
                  onCursor={(cursor) => {
                    // Code → graph: the caret selects the resource it is in.
                    const target = resourceAtLine(
                      live.resources,
                      file.path,
                      editorContent,
                      cursor,
                    );
                    if (target && target.id !== selected) {
                      setSelected(target.id);
                      focusOn(target.id);
                    }
                  }}
                  onChange={(content) => {
                    const next = withDraft(
                      draftsRef.current,
                      file.path,
                      content,
                      file,
                      project.id,
                    );
                    draftsRef.current = next;
                    setDrafts(next);
                  }}
                />
              )}
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
            onClick={() => {
              setCleared("");
              setHelp(true);
            }}
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
              { id: "deploy", label: "Floci", icon: Rocket },
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
      {/* A draft that another open tab is editing is not offered here. */}
      {recovery.offers
        .filter((offer) => !otherTabs.has(offer.file))
        .map(({ entries: [entry, ...older] }) => {
          const saved = project.files.find((f) => f.path === entry.file);
          const current = saved?.revision === entry.baseRevision;
          // This tab already has its own draft of the file (typed before
          // deciding): the stored one is kept apart until the user decides.
          const mine = !!drafts[entry.file];
          // Several closed tabs may have left one each: newest first.
          const more = older.length
            ? older.length === 1
              ? " Hay otro más antiguo; se ofrece después."
              : ` Hay ${older.length} más antiguos; se ofrecen después.`
            : "";
          return (
            <div
              className="global-message recovery-message"
              role="status"
              key={entry.key}
            >
              <History size={16} />
              <span>
                {mine
                  ? `Hay otro borrador de ${entry.file} (${ago(entry.savedAt)}) sin restaurar. Tu borrador actual no lo reemplaza: descárgalo o descártalo cuando decidas.`
                  : !saved
                    ? `Hay un borrador de ${entry.file} (${ago(entry.savedAt)}), pero el archivo ya no está en el proyecto.`
                    : current
                      ? `Hay un borrador sin guardar de ${entry.file} (${ago(entry.savedAt)}).`
                      : `Hay un borrador de ${entry.file} (${ago(entry.savedAt)}), pero el archivo cambió fuera de TerraDock desde entonces.`}
                {more}
              </span>
              {saved && !mine ? (
                <button onClick={() => restoreDraft(entry)}>
                  {current ? "Restaurar borrador" : "Comparar con el disco"}
                </button>
              ) : (
                <button onClick={() => download(entry.file, entry.content)}>
                  Descargar {entry.file}
                </button>
              )}
              <button onClick={() => recovery.discard(entry)}>Descartar</button>
            </div>
          );
        })}
      <div
        className={`workspace ${sidebar ? "" : "sidebar-hidden"} ${resource && (view === "architecture" || view === "split") ? "with-inspector" : ""}`}
      >
        {sidebar && (
          <aside className="explorer">
            <div className="panel-heading">
              <span>EXPLORADOR</span>
              <span className="count-badge">{live.resources.length}</span>
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
                    selectResource(r.id);
                    if (
                      view === "code" ||
                      view === "analysis" ||
                      view === "deploy"
                    )
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
          {view !== "code" && view !== "deploy" && (
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
              <span className="heading-badges">
                {live.live && (
                  <span
                    className={`live-badge ${live.pending ? "pending" : ""}`}
                  >
                    <RadioTower size={13} /> En vivo
                  </span>
                )}
                <span
                  className={`syntax-status ${live.valid ? "" : "invalid"}`}
                >
                  {live.valid ? (
                    <Check size={14} />
                  ) : (
                    <TriangleAlert size={14} />
                  )}
                  {live.valid ? "HCL válido" : "Revisar HCL"}
                </span>
              </span>
            </div>
          )}
          {!live.valid && view !== "analysis" && view !== "deploy" && (
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
                resources={live.resources}
                edges={live.edges}
                selected={selected}
                query={query}
                onSelect={(id) => selectResource(id, true)}
                focus={focus}
                resetKey={`${project.id}:${view}`}
                marks={marks}
              />
            )}
            {(view === "code" || view === "split") && editor}
            {view === "deploy" && (
              <DeployPanel
                status={floci.status}
                available={floci.available}
                error={floci.error}
                running={floci.running}
                hasUnsaved={hasUnsaved}
                jsonFiles={project.files
                  .map((f) => f.path)
                  .filter((path) => path.endsWith(".tf.json"))}
                resourceCount={
                  project.resources.filter((r) => r.block === "resource").length
                }
                onRun={(action, variables) => void floci.run(action, variables)}
                onCancel={() => void floci.cancel()}
              />
            )}
            {view === "analysis" && (
              <div className="analysis-content">
                <div className="analysis-summary">
                  <div>
                    <span>{live.resources.length}</span>
                    <p>Recursos declarados</p>
                  </div>
                  <div>
                    <span>{live.edges.length}</span>
                    <p>Referencias detectadas</p>
                  </div>
                  <div>
                    <span>
                      {
                        live.diagnostics.filter((d) => d.severity === "error")
                          .length
                      }
                    </span>
                    <p>Errores de sintaxis</p>
                  </div>
                  <div>
                    <span>{live.findings.length}</span>
                    <p>Hallazgos estáticos</p>
                  </div>
                </div>
                <p className="analysis-note">
                  Se revisan sintaxis, referencias directas, CIDR de subredes y
                  reglas SSH literales. Esto no verifica el estado desplegado ni
                  reemplaza una auditoría de seguridad.
                </p>
                {live.diagnostics.map((d, i) => (
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
                {live.findings.map((f) => (
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
            resources={live.resources}
            valid={live.valid}
            drafts={properties}
            syncNote={syncNote}
            onDraft={(key, next) =>
              setProperties((current) =>
                next ? { ...current, [key]: next } : without(current, key),
              )
            }
            onApply={applyProperty}
            onCode={code}
            onSelect={selectResource}
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
        <span className="live-status" data-testid="sync-status">
          <RadioTower size={11} />
          {syncNote}
        </span>
        <span>{live.resources.length} recursos</span>
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
                <strong>Edita en cualquier lado</strong>: lo que escribes en el
                código se ve al instante en el diagrama y lo que cambias en el
                inspector aparece en el código. Con el autoguardado activo, los
                cambios válidos llegan al archivo; los cambios externos se
                detectan al momento.
              </li>
              <li>
                <strong>Despliega en Floci</strong> desde la pestaña Floci:
                plan, aplicar y destruir contra el emulador local.
              </li>
            </ol>
            <p>
              Todo se sirve desde tu equipo. Abrir una carpeta, analizar y
              editar no ejecutan Terraform ni contactan proveedores cloud ni
              Floci. Los módulos se muestran sin expandir y <code>count</code>/
              <code>for_each</code> no se evalúan.
            </p>
            <p>
              Solo la pestaña Floci, mientras está abierta o hay una operación
              en curso, consulta el emulador local y la versión de Terraform.
              Plan, aplicar, destruir y Leer estado ejecutan Terraform contra el
              emulador: <code>terraform init</code> descarga providers la
              primera vez en cada proyecto, e Iniciar Floci puede descargar su
              imagen Docker si falta.
            </p>
            <p className="root-note">
              Una instancia del servidor comparte el proyecto entre sus
              pestañas. Los borradores sin guardar se conservan en este
              navegador: al volver a abrir el proyecto puedes restaurarlos. Se
              eliminan al volver a abrir TerraDock en esta dirección pasados 7
              días. Cualquier otra aplicación servida en el mismo puerto
              comparte ese almacenamiento.
            </p>
            <div className="help-actions">
              <button
                className="button-secondary"
                onClick={() =>
                  void recovery
                    .clearStored()
                    .then((count) =>
                      setCleared(
                        count === 0
                          ? "No había borradores guardados de otras pestañas."
                          : count === 1
                            ? "Se borró 1 borrador guardado."
                            : `Se borraron ${count} borradores guardados.`,
                      ),
                    )
                }
              >
                Borrar borradores guardados en este navegador
              </button>
              {cleared && <span role="status">{cleared}</span>}
            </div>
            <p className="field-note">
              Los borradores abiertos en esta pestaña se siguen guardando
              mientras la tengas abierta.
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
