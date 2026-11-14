import type { Edge, Node } from "@xyflow/react";
import type { Resource, ResourceEdge } from "../../lib/types";
import { hidesValue, SENSITIVE_TEXT } from "../../lib/sensitive";

export type ResourceNodeData = {
  resource: Resource;
  childCount: number;
  muted: boolean;
} & Record<string, unknown>;
export type ResourceNode = Node<ResourceNodeData>;
export const isScope = (r: Resource) =>
  r.block === "resource" && ["aws_vpc", "aws_subnet"].includes(r.type);

/**
 * Loose nodes are laid out in lanes, each starting a new column: resources,
 * data sources and modules first (as before), then providers, variables,
 * locals and outputs.
 */
const lanes: Partial<Record<Resource["block"], number>> = {
  provider: 1,
  variable: 2,
  local: 3,
  output: 4,
};
export const laneOf = (r: Resource) => lanes[r.block] ?? 0;

/** Only explicit VPC/subnet references create containment. Other links remain edges. */
export function buildGraph(
  resources: Resource[],
  relationships: ResourceEdge[],
  selected: string,
  query = "",
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
    if (p) children.set(p, [...(children.get(p) ?? []), r]);
  });
  const sizes = new Map<string, { width: number; height: number }>();
  function measure(r: Resource): { width: number; height: number } {
    if (!isScope(r)) return { width: 214, height: 96 };
    const nested = children.get(r.id) ?? [];
    const groups = nested.filter(isScope),
      leaves = nested.filter((item) => !isScope(item));
    const width = r.type === "aws_vpc" ? 626 : 280;
    const groupHeight = groups.length
      ? Math.max(...groups.map(measure).map((s) => s.height))
      : 0;
    const columns = r.type === "aws_vpc" ? 2 : 1;
    const height =
      72 +
      Math.ceil(groups.length / 2) * (groupHeight + 24) +
      Math.ceil(leaves.length / columns) * 116 +
      16;
    const size = {
      width,
      height: Math.max(r.type === "aws_vpc" ? 220 : 166, height),
    };
    sizes.set(r.id, size);
    return size;
  }
  const nodes: ResourceNode[] = [];
  function place(r: Resource, x: number, y: number, parentId?: string) {
    const nested = children.get(r.id) ?? [];
    const size = isScope(r)
      ? (sizes.get(r.id) ?? measure(r))
      : { width: 214, height: 96 };
    const matches =
      !query ||
      `${r.id} ${r.label} ${r.type}`
        .toLowerCase()
        .includes(query.toLowerCase());
    nodes.push({
      id: r.id,
      type: isScope(r) ? "scope" : "resource",
      position: { x, y },
      parentId,
      extent: parentId ? "parent" : undefined,
      style: size,
      selected: r.id === selected,
      data: { resource: r, childCount: nested.length, muted: !matches },
    });
    const groups = nested.filter(isScope),
      leaves = nested.filter((item) => !isScope(item));
    const rowHeight = groups.length
      ? Math.max(
          ...groups.map((item) => (sizes.get(item.id) ?? measure(item)).height),
        ) + 24
      : 0;
    groups.forEach((item, i) =>
      place(item, 22 + (i % 2) * 302, 68 + Math.floor(i / 2) * rowHeight, r.id),
    );
    const start = 68 + Math.ceil(groups.length / 2) * rowHeight;
    const columns = r.type === "aws_vpc" ? 2 : 1;
    leaves.forEach((item, i) =>
      place(
        item,
        24 + (i % columns) * 300,
        start + Math.floor(i / columns) * 116,
        r.id,
      ),
    );
  }
  const roots = resources.filter((r) => !parent(r));
  let x = 20;
  roots.filter(isScope).forEach((r) => {
    const size = measure(r);
    place(r, x, 30);
    x += size.width + 42;
  });
  const loose = roots.filter((r) => !isScope(r));
  let column = 0;
  for (let lane = 0; lane <= 4; lane++) {
    const items = loose.filter((r) => laneOf(r) === lane);
    items.forEach((r, i) =>
      place(r, x + (column + Math.floor(i / 6)) * 248, 44 + (i % 6) * 130),
    );
    column += Math.ceil(items.length / 6);
  }
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
  return { nodes, edges };
}

/**
 * Puts new top-level nodes in a free column to the right of the nodes that
 * kept their position, stacked from the top. Nested nodes are relative to
 * their scope and stay where the layout put them.
 */
export function placeAdded(
  nodes: ResourceNode[],
  added: ReadonlySet<string>,
): ResourceNode[] {
  let right = -Infinity;
  for (const n of nodes)
    if (!n.parentId && !added.has(n.id))
      right = Math.max(right, n.position.x + Number(n.style?.width ?? 214));
  if (right === -Infinity) return nodes;
  let y = 30;
  return nodes.map((n) => {
    if (n.parentId || !added.has(n.id)) return n;
    const placed = { ...n, position: { x: right + 60, y } };
    y += Number(n.style?.height ?? 96) + 34;
    return placed;
  });
}

/**
 * Merges a new layout into the nodes on screen: a node keeps its position
 * (and its object, when `unchanged` says nothing visible changed). Only
 * `created`, a resource this client just created, moves to free space if it
 * is new; renamed or reappearing nodes take their place in the layout.
 */
export function keepPositions(
  previous: ResourceNode[],
  next: ResourceNode[],
  unchanged: (node: ResourceNode) => boolean,
  created = "",
): ResourceNode[] {
  const byId = new Map(previous.map((n) => [n.id, n]));
  let kept = 0;
  const merged = next.map((node) => {
    const old = byId.get(node.id);
    if (!old || old.parentId !== node.parentId) return node;
    kept++;
    return unchanged(node) ? old : { ...node, position: old.position };
  });
  return created && kept && !byId.has(created)
    ? placeAdded(merged, new Set([created]))
    : merged;
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
