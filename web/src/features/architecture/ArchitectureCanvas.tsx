import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import {
  Download,
  Maximize,
  Minus,
  Network,
  Plus,
  Repeat2,
  Workflow,
} from "lucide-react";
import type { Resource, ResourceEdge } from "../../lib/types";
import {
  buildGraph,
  cardDetail,
  nodeSignature,
  repeatMark,
  scopeMeta,
  shortType,
  type ResourceNode,
} from "./graph";
import { iconFor, markStyle } from "./diagramIcons";
import type { DeployMark } from "../deploy/useFloci";
import { exportDiagram, type ExportFormat } from "./rasterize";
import { download } from "../../lib/download";
import { replacesDiagram, stabilize, type Remembered } from "./layout/stable";
import { layeredLayout } from "./layout/layered";

/**
 * The places of the last project shown, kept while the diagram is unmounted
 * (code and analysis views) so coming back does not move anything.
 */
let remembered: {
  projectKey: string;
  nodes: ResourceNode[];
  removed: Remembered;
} | null = null;

function NodeMark({ mark }: { mark?: DeployMark }) {
  return mark ? (
    <span className={`deploy-mark mark-${mark}`} data-testid="deploy-mark">
      {markStyle[mark].label}
    </span>
  ) : null;
}
/** Everything that affects how a node renders, except its position. */
function nodeKey(node: ResourceNode) {
  const { resource, ...rest } = node.data;
  return JSON.stringify([
    node.type,
    node.parentId,
    node.style,
    node.width,
    node.height,
    node.selected,
    node.zIndex,
    node.extent,
    nodeSignature(resource),
    rest,
  ]);
}
const sameEdges = (a: Edge[], b: Edge[]) =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

export function ResourceIcon({
  resource,
  size = 20,
}: {
  resource: Resource;
  size?: number;
}) {
  const { Icon } = iconFor(resource);
  return <Icon size={size} strokeWidth={1.65} />;
}

function RepeatMark({ resource }: { resource: Resource }) {
  const mark = repeatMark(resource);
  if (!mark) return null;
  return (
    <span className="repeat-mark" data-testid="repeat-mark" title={mark.title}>
      <Repeat2 size={11} />
      {mark.text}
    </span>
  );
}

function ResourceCard({ data }: NodeProps<ResourceNode>) {
  const r = data.resource;
  const icon = iconFor(r);
  return (
    <div
      className={`resource-node ${r.category} ${data.muted ? "is-muted" : ""} ${data.updated ? "is-updated" : ""}`}
      data-testid={`node-${r.id}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="node-heading">
        <span
          className="resource-icon"
          style={{ color: icon.color, background: icon.background }}
        >
          <ResourceIcon resource={r} />
        </span>
        <span className="node-kind">{shortType(r.type)}</span>
        <RepeatMark resource={r} />
        <NodeMark mark={data.mark as DeployMark | undefined} />
        {!data.mark && <span className="node-dot" />}
      </div>
      <strong title={r.id}>{r.label || r.name}</strong>
      <span className="node-detail">{cardDetail(r)}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ScopeCard({ data }: NodeProps<ResourceNode>) {
  const r = data.resource;
  const [cidr, detail] = scopeMeta(r, data.childCount);
  return (
    <div
      className={`scope-node ${r.type === "aws_vpc" ? "vpc-scope" : "subnet-scope"} ${data.muted ? "is-muted" : ""} ${data.updated ? "is-updated" : ""}`}
      data-testid={`node-${r.id}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="scope-heading">
        <span className="scope-icon">
          <ResourceIcon resource={r} size={17} />
        </span>
        <strong>{r.label || r.name}</strong>
        <span className="scope-type">{shortType(r.type)}</span>
        <RepeatMark resource={r} />
        <NodeMark mark={data.mark as DeployMark | undefined} />
      </div>
      <div className="scope-meta">
        <span>{cidr}</span>
        <span>{detail}</span>
      </div>
      {!data.childCount && (
        <span className="empty-scope">Sin recursos asociados</span>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { resource: ResourceCard, scope: ScopeCard };
interface Props {
  resources: Resource[];
  edges: ResourceEdge[];
  selected: string;
  query: string;
  onSelect: (id: string) => void;
  /** Changes with the project or the view: refits the viewport, moves nothing. */
  resetKey: string;
  marks?: Record<string, DeployMark>;
  focus?: { id: string; n: number };
  /** Opens the "create resource" dialog (button and right click on the canvas). */
  onCreate?: () => void;
  /**
   * Identity of the project (its id): a different one is laid out from
   * scratch, the only time the layout runs by itself.
   */
  project?: string;
  /**
   * A resource this client just created. stabilize() places it like any new
   * node, next to its first neighbor; the app then centers it.
   */
  created?: string;
  /** The created resource is on the canvas. */
  onPlaced?: (id: string) => void;
  /** Named in the band of SVG/PNG exports. */
  projectName?: string;
  /** Files with unsaved drafts that the diagram reflects. */
  unsavedFiles?: number;
}
function Graph({
  resources,
  edges: relations,
  selected,
  query,
  onSelect,
  resetKey,
  marks,
  focus,
  onCreate,
  project: projectKey = "",
  created = "",
  onPlaced,
  projectName = "Proyecto",
  unsavedFiles = 0,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<ResourceNode>(
    remembered?.projectKey === projectKey ? remembered.nodes : [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const {
    fitView,
    zoomIn,
    zoomOut,
    getInternalNode,
    getZoom,
    setCenter,
    getNodes,
    getEdges,
  } = useReactFlow<ResourceNode>();
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  // From the model, not the DOM: with more than 150 resources only the
  // visible nodes are rendered.
  const exportAs = async (format: ExportFormat) => {
    setExportOpen(false);
    setExportError("");
    setExporting(format);
    try {
      const { blob, name } = await exportDiagram(format, {
        nodes: getNodes(),
        edges: getEdges(),
        caption: {
          project: projectName,
          date: new Intl.DateTimeFormat("es", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date()),
          resources: resources.length,
          filter: query.trim() || undefined,
          drafts: unsavedFiles,
        },
      });
      download(name, blob);
    } catch (error) {
      // The browser's own message is technical and in English: it goes to
      // the console, the interface says what happened.
      console.error("No se pudo exportar el diagrama", error);
      setExportError(
        "No se pudo exportar el diagrama. El detalle está en la consola del navegador.",
      );
    } finally {
      setExporting("");
    }
  };
  // Center on resources chosen outside the canvas (explorer, editor caret,
  // inspector references), even in large diagrams that only render what is
  // visible. `focus.n` changes on every request, including repeated ones.
  const focusN = focus?.n ?? 0,
    focusId = focus?.id ?? "";
  useEffect(() => {
    if (!focusId) return;
    const timer = window.setTimeout(() => {
      const node = getInternalNode(focusId);
      if (!node) return;
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured.width ?? 214,
        height = node.measured.height ?? 96;
      void setCenter(x + width / 2, y + height / 2, {
        zoom: Math.max(getZoom(), 0.75),
        duration: 250,
      });
    }, 60);
    return () => clearTimeout(timer);
  }, [focusN, focusId, getInternalNode, getZoom, setCenter]);
  // Flash nodes whose declaration changed, so live edits are easy to follow.
  const signatures = useRef<Map<string, string> | null>(null);
  const [updated, setUpdated] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Map(resources.map((r) => [r.id, nodeSignature(r)]));
    const previous = signatures.current;
    signatures.current = next;
    if (!previous) return;
    const changed = new Set(
      [...next]
        .filter(([id, sig]) => previous.get(id) !== sig)
        .map(([id]) => id),
    );
    if (!changed.size) return;
    setUpdated(changed);
    const timer = window.setTimeout(() => setUpdated(new Set()), 900);
    return () => clearTimeout(timer);
  }, [resources]);
  useEffect(() => {
    signatures.current = null;
  }, [resetKey]);
  const decorate = useCallback(
    (list: ResourceNode[]) =>
      list.map((node) => ({
        ...node,
        data: {
          ...node.data,
          mark: marks?.[node.id],
          updated: updated.has(node.id),
        },
      })),
    [marks, updated],
  );
  // Reusing the previous node object when nothing visible changed and it did
  // not move lets React Flow skip re-rendering it, which keeps large diagrams
  // responsive while typing.
  const nodeKeys = useRef(new Map<string, string>());
  const reuse = useCallback(
    (previous: ResourceNode[], placed: ResourceNode[]) => {
      const byId = new Map(previous.map((n) => [n.id, n]));
      const keys = new Map<string, string>();
      const next = placed.map((node) => {
        const key = nodeKey(node);
        keys.set(node.id, key);
        const old = byId.get(node.id);
        return old &&
          nodeKeys.current.get(node.id) === key &&
          old.position.x === node.position.x &&
          old.position.y === node.position.y
          ? old
          : node;
      });
      nodeKeys.current = keys;
      return next;
    },
    [],
  );
  // "Ordenar": the full layered layout, on demand.
  const layout = useCallback(() => {
    const graph = buildGraph(resources, relations, selected, query, "layered");
    setNodes((previous) => reuse(previous, decorate(graph.nodes)));
    setEdges(graph.edges);
  }, [
    resources,
    relations,
    selected,
    query,
    setNodes,
    setEdges,
    decorate,
    reuse,
  ]);
  // The full layout runs once per project. After that, every update (typing,
  // the inspector, a file changed on disk, switching views) keeps the places
  // and only fits new nodes in: stabilize() never lays everything out again.
  // Only an update that replaces most of the diagram is laid out again.
  const laidOut = useRef(
    remembered?.projectKey === projectKey ? projectKey : "",
  );
  const forgotten = useRef<Remembered>(
    remembered?.projectKey === projectKey ? remembered.removed : new Map(),
  );
  useEffect(() => {
    const full = laidOut.current !== projectKey;
    if (full) forgotten.current = new Map();
    if (full && resources.length) laidOut.current = projectKey;
    const graph = buildGraph(
      resources,
      relations,
      selected,
      query,
      full ? "layered" : "grid",
    );
    setNodes((previous) => {
      if (full) return reuse(previous, decorate(graph.nodes));
      // Most of the diagram replaced (another branch, a large file pasted):
      // lay it out from scratch instead of keeping the few places in common.
      const placed = replacesDiagram(previous, graph.nodes)
        ? layeredLayout(graph.nodes, graph.edges)
        : stabilize(previous, graph.nodes, graph.edges, forgotten.current);
      return reuse(previous, decorate(placed));
    });
    setEdges((previous) =>
      sameEdges(previous, graph.edges) ? previous : graph.edges,
    );
    // The created resource went next to its first neighbor like any new
    // node; from now on it keeps its place like the rest.
    if (created && graph.nodes.some((node) => node.id === created))
      onPlaced?.(created);
  }, [
    resources,
    relations,
    selected,
    query,
    projectKey,
    created,
    onPlaced,
    setNodes,
    setEdges,
    decorate,
    reuse,
  ]);
  // Leaving the diagram (the code view unmounts it) and coming back keeps
  // the places of the same project.
  useEffect(() => {
    remembered = { projectKey, nodes, removed: forgotten.current };
  }, [projectKey, nodes]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.1, duration: 250 });
    }, 160);
    return () => clearTimeout(timer);
  }, [resetKey, fitView]);
  return (
    <div className="graph-surface" data-testid="architecture-canvas">
      <div className="canvas-context">
        <span className="aws-mark">
          {resources.length > 0 &&
          resources.every((r) => r.type.startsWith("aws_"))
            ? "aws"
            : "tf"}
        </span>
        <span>Configuración declarada</span>
        <span className="context-dot" />
        <span>Vista de arquitectura</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneContextMenu={(event) => {
          if (!onCreate) return;
          event.preventDefault();
          onCreate();
        }}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        onlyRenderVisibleElements={resources.length > 150}
        minZoom={0.25}
        maxZoom={1.75}
        nodesConnectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: false }}
      >
        <Background
          color="#c5d0db"
          gap={20}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <MiniMap
          style={{ width: 118, height: 80 }}
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(node) => (node.type === "scope" ? "#d1e2ed" : "#96afc9")}
          maskColor="rgba(238,243,248,0.65)"
        />
      </ReactFlow>
      {onCreate && (
        <button
          className="canvas-create"
          title="Crear recurso (también con clic derecho en el lienzo)"
          onClick={onCreate}
        >
          <Plus size={15} /> Crear recurso
        </button>
      )}
      <div className="canvas-controls">
        <button
          aria-label="Alejar"
          title="Alejar"
          onClick={() => void zoomOut()}
        >
          <Minus size={16} />
        </button>
        <button
          aria-label="Acercar"
          title="Acercar"
          onClick={() => void zoomIn()}
        >
          <Plus size={16} />
        </button>
        <span />
        <button
          aria-label="Ajustar diagrama"
          title="Ajustar diagrama"
          onClick={() => void fitView({ padding: 0.1, duration: 250 })}
        >
          <Maximize size={16} />
        </button>
        <button
          className="layout-button"
          onClick={() => {
            layout();
            window.setTimeout(
              () => void fitView({ padding: 0.1, duration: 250 }),
              60,
            );
          }}
        >
          <Workflow size={15} /> Ordenar
        </button>
        <button
          className="layout-button"
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          disabled={!resources.length || !!exporting}
          title="Exportar el diagrama completo como imagen"
          onClick={() => setExportOpen((open) => !open)}
        >
          <Download size={15} />{" "}
          {exporting ? `Exportando ${exporting.toUpperCase()}…` : "Exportar"}
        </button>
        {exportOpen && (
          <div
            className="export-menu"
            role="menu"
            aria-label="Formato de exportación"
            onKeyDown={(event) => {
              if (event.key === "Escape") setExportOpen(false);
            }}
          >
            <button role="menuitem" onClick={() => void exportAs("svg")}>
              SVG <span>vectorial, con fuentes</span>
            </button>
            <button role="menuitem" onClick={() => void exportAs("png")}>
              PNG <span>imagen a 2×</span>
            </button>
          </div>
        )}
      </div>
      {exportError && (
        <div className="export-error" role="alert">
          {exportError}
          <button aria-label="Cerrar aviso" onClick={() => setExportError("")}>
            ×
          </button>
        </div>
      )}
      <div className="canvas-legend">
        <span>
          <i className="legend-containment" /> Agrupación
        </span>
        <span>
          <i className="legend-reference" /> Referencia
        </span>
        {marks && Object.keys(marks).length > 0 && (
          <span>
            <i className="legend-floci" /> Floci
          </span>
        )}
      </div>
      {!resources.length && (
        <div className="canvas-empty">
          <Network size={36} />
          <h3>No hay recursos para mostrar</h3>
          <p>Abre un ejemplo o revisa los archivos Terraform del proyecto.</p>
        </div>
      )}
    </div>
  );
}
export function ArchitectureCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
