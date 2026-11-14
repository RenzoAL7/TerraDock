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
  Box,
  Database,
  Globe2,
  Layers3,
  LogOut,
  Maximize,
  Minus,
  Network,
  Plug,
  Plus,
  Repeat2,
  Route,
  Server,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import type { Resource, ResourceEdge } from "../../lib/types";
import { hidesValue, SENSITIVE_TEXT } from "../../lib/sensitive";
import {
  buildGraph,
  keepPositions,
  nodeSignature,
  shortType,
  type ResourceNode,
} from "./graph";
import type { DeployMark } from "../deploy/useFloci";

const markLabel: Record<DeployMark, string> = {
  create: "+ crear",
  update: "~ actualizar",
  replace: "± reemplazar",
  delete: "− eliminar",
  deployed: "✓ en Floci",
};
function NodeMark({ mark }: { mark?: DeployMark }) {
  return mark ? (
    <span className={`deploy-mark mark-${mark}`} data-testid="deploy-mark">
      {markLabel[mark]}
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
  const Icon =
    resource.type === "aws_internet_gateway"
      ? Globe2
      : resource.type.includes("route")
        ? Route
        : {
            network: Network,
            compute: Server,
            security: ShieldCheck,
            database: Database,
            storage: Box,
            loadbalancer: Workflow,
            variable: SlidersHorizontal,
            local: Sigma,
            output: LogOut,
            provider: Plug,
            other: Layers3,
          }[resource.category] || Layers3;
  return <Icon size={size} strokeWidth={1.65} />;
}

/** The one value a card shows under its name, by kind of declaration. */
const detailProperties: Partial<Record<Resource["block"], string[]>> = {
  variable: ["default", "type"],
  local: ["value"],
  output: ["value"],
  provider: ["region"],
};

/**
 * count / for_each blocks are declarations, not expanded instances: say so on
 * the card instead of drawing a guessed number of copies.
 */
function RepeatMark({ resource }: { resource: Resource }) {
  const p = resource.properties.find(
    (p) => p.name === "count" || p.name === "for_each",
  );
  if (!p) return null;
  const text =
    p.name === "count" ? `× ${String(p.value ?? p.expression)}` : `for_each`;
  return (
    <span
      className="repeat-mark"
      data-testid="repeat-mark"
      title={`${p.name} = ${p.expression}. Se muestra el bloque declarado, sin expandir sus instancias.`}
    >
      <Repeat2 size={11} />
      {text}
    </span>
  );
}

function ResourceCard({ data }: NodeProps<ResourceNode>) {
  const r = data.resource;
  const names = detailProperties[r.block] ?? [
    "instance_type",
    "engine",
    "bucket_prefix",
    "internal",
  ];
  const p = names
    .map((name) => r.properties.find((p) => p.name === name))
    .find(Boolean);
  return (
    <div
      className={`resource-node ${r.category} ${data.muted ? "is-muted" : ""} ${data.updated ? "is-updated" : ""}`}
      data-testid={`node-${r.id}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="node-heading">
        <span className="resource-icon">
          <ResourceIcon resource={r} />
        </span>
        <span className="node-kind">{shortType(r.type)}</span>
        <RepeatMark resource={r} />
        <NodeMark mark={data.mark as DeployMark | undefined} />
        {!data.mark && <span className="node-dot" />}
      </div>
      <strong title={r.id}>{r.label || r.name}</strong>
      <span className="node-detail">
        {p
          ? hidesValue(r, p)
            ? SENSITIVE_TEXT
            : String(p.value ?? p.expression).replaceAll('"', "")
          : r.file}
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ScopeCard({ data }: NodeProps<ResourceNode>) {
  const r = data.resource;
  const cidr = r.properties.find((p) => p.name === "cidr_block"),
    az = r.properties.find((p) => p.name === "availability_zone");
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
        <span>{String(cidr?.value ?? cidr?.expression ?? "")}</span>
        <span>
          {az
            ? String(az.value ?? az.expression)
            : `${data.childCount} recursos`}
        </span>
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
  resetKey: string;
  marks?: Record<string, DeployMark>;
  focus?: { id: string; n: number };
  /** Opens the "create resource" dialog (button and right click on the canvas). */
  onCreate?: () => void;
  /** Identity of the project: a different one is laid out from scratch. */
  project?: string;
  /** A resource this client just created, placed beside the diagram. */
  created?: string;
  /** The created resource is on the canvas: stop placing it. */
  onPlaced?: (id: string) => void;
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
  project = "",
  created = "",
  onPlaced,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<ResourceNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, zoomIn, zoomOut, getInternalNode, getZoom, setCenter } =
    useReactFlow();
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
  const layout = useCallback(() => {
    const graph = buildGraph(resources, relations, selected, query);
    setNodes(decorate(graph.nodes));
    setEdges(graph.edges);
  }, [resources, relations, selected, query, setNodes, setEdges, decorate]);
  // Live edits rebuild the graph on every keystroke. Reusing the previous node
  // object when nothing visible changed lets React Flow skip re-rendering it,
  // which keeps large diagrams responsive.
  const nodeKeys = useRef(new Map<string, string>());
  const laidOut = useRef(project);
  useEffect(() => {
    const graph = buildGraph(resources, relations, selected, query);
    // Another project gets a full layout instead of the old positions.
    const fresh = laidOut.current !== project;
    laidOut.current = project;
    setNodes((previous) => {
      const next = decorate(graph.nodes);
      const keys = new Map(next.map((node) => [node.id, nodeKey(node)]));
      const merged = fresh
        ? next
        : keepPositions(
            previous,
            next,
            (node) => nodeKeys.current.get(node.id) === keys.get(node.id),
            created,
          );
      nodeKeys.current = keys;
      return merged;
    });
    setEdges((previous) =>
      sameEdges(previous, graph.edges) ? previous : graph.edges,
    );
    // Placed once: later it keeps its position like any other node, and a
    // block with the same name typed later is laid out normally.
    if (created && graph.nodes.some((node) => node.id === created))
      onPlaced?.(created);
  }, [
    resources,
    relations,
    selected,
    query,
    setNodes,
    setEdges,
    decorate,
    project,
    created,
    onPlaced,
  ]);
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
      </div>
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
