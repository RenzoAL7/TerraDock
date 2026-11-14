import type { Edge, Node } from "@xyflow/react";
import type { Resource, ResourceEdge } from "../../lib/types";
import { hidesValue, SENSITIVE_TEXT } from "../../lib/sensitive";
import { laneOf, LEAF } from "./layout/geometry";
import { gridLayout } from "./layout/grid";
import { layeredLayout } from "./layout/layered";

export { laneOf };

export type ResourceNodeData = {
  resource: Resource;
  childCount: number;
  muted: boolean;
} & Record<string, unknown>;
export type ResourceNode = Node<ResourceNodeData>;
export const isScope = (r: Resource) =>
  r.block === "resource" && ["aws_vpc", "aws_subnet"].includes(r.type);

/**
 * How a full layout places the nodes. "grid" is the fixed grid; "layered"
 * puts references top to bottom (dagre) inside each container. While typing
 * neither runs: stabilize() keeps every place and fits the new nodes in.
 */
export type LayoutKind = "grid" | "layered";

/** Only explicit VPC/subnet references create containment. Other links remain edges. */
export function buildGraph(
  resources: Resource[],
  relationships: ResourceEdge[],
  selected: string,
  query = "",
  layout: LayoutKind = "grid",
): { nodes: ResourceNode[]; edges: Edge[] } {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const children = new Map<string, Resource[]>();
  const parent = (r: Resource): string | undefined => {
    const p = r.parentId && byId.get(r.parentId);
    if (
      !p ||
      !isScope(p) ||
      p.id === r.id ||
      r.type === "aws_vpc" ||
      (r.type === "aws_subnet" && p.type !== "aws_vpc")
    )
      return undefined;
    return p.id;
  };
  resources.forEach((r) => {
    const p = parent(r);
    if (p) {
      const list = children.get(p);
      if (list) list.push(r);
      else children.set(p, [r]);
    }
  });
  // Parents before children (React Flow needs it): each container, then its
  // subnets, then its resources; top-level containers first, then the loose
  // nodes lane by lane.
  const nodes: ResourceNode[] = [];
  const lowerQuery = query.toLowerCase();
  function add(r: Resource, parentId?: string) {
    const nested = children.get(r.id) ?? [];
    const matches =
      !query ||
      `${r.id} ${r.label} ${r.type}`.toLowerCase().includes(lowerQuery);
    nodes.push({
      id: r.id,
      type: isScope(r) ? "scope" : "resource",
      position: { x: 0, y: 0 },
      parentId,
      extent: parentId ? "parent" : undefined,
      style: LEAF,
      selected: r.id === selected,
      data: { resource: r, childCount: nested.length, muted: !matches },
    });
    nested.filter(isScope).forEach((item) => add(item, r.id));
    nested.filter((item) => !isScope(item)).forEach((item) => add(item, r.id));
  }
  const roots = resources.filter((r) => !parent(r));
  roots.filter(isScope).forEach((r) => add(r));
  const loose = roots.filter((r) => !isScope(r));
  for (let lane = 0; lane <= 4; lane++)
    loose.filter((r) => laneOf(r) === lane).forEach((r) => add(r));
  const edges = relationships
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .filter((e) => parent(byId.get(e.target)!) !== e.source)
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: false,
      style: {
        stroke:
          e.source === selected || e.target === selected
            ? "#448ec1"
            : "#a0b4c7",
        strokeWidth: e.source === selected || e.target === selected ? 2 : 1.2,
        opacity:
          selected && e.source !== selected && e.target !== selected
            ? 0.2
            : 0.65,
      },
      data: { reason: e.label },
      zIndex: 2,
    }));
  return {
    nodes:
      layout === "layered" ? layeredLayout(nodes, edges) : gridLayout(nodes),
    edges,
  };
}

export const categoryNames: Record<string, string> = {
  network: "Networking",
  compute: "Compute",
  security: "Seguridad",
  storage: "Storage",
  database: "Database",
  loadbalancer: "Load balancing",
  variable: "Variables",
  local: "Valores locales",
  output: "Salidas",
  provider: "Proveedores",
  other: "Otros",
};
export function shortType(type: string) {
  const names: Record<string, string> = {
    aws_vpc: "VPC",
    aws_subnet: "Subnet",
    aws_instance: "EC2 instance",
    aws_lb: "Load balancer",
    aws_db_instance: "RDS database",
    aws_db_subnet_group: "DB subnet group",
    aws_security_group: "Security group",
    aws_s3_bucket: "S3 bucket",
    aws_internet_gateway: "Internet gateway",
    aws_route_table: "Route table",
    aws_route: "Route",
    aws_nat_gateway: "NAT gateway",
    variable: "Variable",
    local: "Valor local",
    output: "Salida",
    provider: "Proveedor",
    module: "Módulo",
  };
  return names[type] ?? type.replace(/^aws_/, "").replaceAll("_", " ");
}

/**
 * What a node shows, to flash nodes that changed and to reuse the rest. The
 * read-only explanations are left out: they are long, never drawn on a card,
 * and would be serialized for every node on every update.
 */
export function nodeSignature(r: Resource) {
  return JSON.stringify([
    r.label,
    r.parentId,
    r.properties.map((p) => [
      p.name,
      p.expression,
      p.value,
      p.kind,
      p.editable,
      p.line,
    ]),
    r.dependsOn,
  ]);
}

/** The one value a card shows under its name, by kind of declaration. */
const detailProperties: Partial<Record<Resource["block"], string[]>> = {
  variable: ["default", "type"],
  local: ["value"],
  output: ["value"],
  provider: ["region"],
};

/**
 * The line under a card's name: its main value, hidden when Terraform would
 * redact it, or the file it is declared in.
 */
export function cardDetail(r: Resource): string {
  const names = detailProperties[r.block] ?? [
    "instance_type",
    "engine",
    "bucket_prefix",
    "internal",
  ];
  const p = names
    .map((name) => r.properties.find((p) => p.name === name))
    .find(Boolean);
  if (!p) return r.file;
  return hidesValue(r, p)
    ? SENSITIVE_TEXT
    : String(p.value ?? p.expression).replaceAll('"', "");
}

/**
 * count / for_each blocks are declarations, not expanded instances: the card
 * says so instead of drawing a guessed number of copies.
 */
export function repeatMark(
  r: Resource,
): { text: string; title: string } | null {
  const p = r.properties.find(
    (p) => p.name === "count" || p.name === "for_each",
  );
  if (!p) return null;
  return {
    text:
      p.name === "count" ? `× ${String(p.value ?? p.expression)}` : "for_each",
    title: `${p.name} = ${p.expression}. Se muestra el bloque declarado, sin expandir sus instancias.`,
  };
}

/** VPC/subnet meta line: CIDR on the left; zone or child count on the right. */
export function scopeMeta(r: Resource, childCount: number): [string, string] {
  const cidr = r.properties.find((p) => p.name === "cidr_block"),
    az = r.properties.find((p) => p.name === "availability_zone");
  return [
    String(cidr?.value ?? cidr?.expression ?? ""),
    az ? String(az.value ?? az.expression) : `${childCount} recursos`,
  ];
}
