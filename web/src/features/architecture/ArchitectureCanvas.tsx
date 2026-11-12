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
  Maximize,
  Minus,
  Network,
  Plus,
  Route,
  Server,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { Resource, ResourceEdge } from "../../lib/types";
import { buildGraph, shortType, type ResourceNode } from "./graph";
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
/** A stable signature of what a node shows, to flash nodes that changed. */
const signature = (r: Resource) =>
  JSON.stringify([r.label, r.parentId, r.properties, r.dependsOn]);

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
            other: Layers3,
          }[resource.category] || Layers3;
  return <Icon size={size} strokeWidth={1.65} />;
}

function ResourceCard({ data }: NodeProps<ResourceNode>) {
  const r = data.resource;
  const p = r.properties.find((p) =>
    ["instance_type", "engine", "bucket_prefix", "internal"].includes(p.name),
  );
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
        <NodeMark mark={data.mark as DeployMark | undefined} />
        {!data.mark && <span className="node-dot" />}
      </div>
      <strong title={r.id}>{r.label || r.name}</strong>
      <span className="node-detail">
        {p ? String(p.value ?? p.expression).replaceAll('"', "") : r.file}
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
}
function Graph({
  resources,
  edges: relations,
  selected,
  query,
  onSelect,
  resetKey,
  marks,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<ResourceNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  // Flash nodes whose declaration changed, so live edits are easy to follow.
  const signatures = useRef<Map<string, string> | null>(null);
  const [updated, setUpdated] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Map(resources.map((r) => [r.id, signature(r)]));
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
  useEffect(() => {
    const graph = buildGraph(resources, relations, selected, query);
    setNodes((previous) =>
      decorate(graph.nodes).map((node) => {
        const old = previous.find(
          (n) => n.id === node.id && n.parentId === node.parentId,
        );
        return old ? { ...node, position: old.position } : node;
      }),
    );
    setEdges(graph.edges);
  }, [resources, relations, selected, query, setNodes, setEdges, decorate]);
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
        fitView
        fitViewOptions={{ padding: 0.1 }}
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
