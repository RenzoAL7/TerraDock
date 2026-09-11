import type { Edge, Node } from "@xyflow/react";
import type { Resource, ResourceEdge } from "../../lib/types";

export type ResourceNodeData = {
  resource: Resource;
  childCount: number;
  muted: boolean;
} & Record<string, unknown>;
export type ResourceNode = Node<ResourceNodeData>;
export const isScope = (r: Resource) =>
  ["aws_vpc", "aws_subnet"].includes(r.type);

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
  roots
    .filter((r) => !isScope(r))
    .forEach((r, i) =>
      place(r, x + Math.floor(i / 6) * 248, 44 + (i % 6) * 130),
    );
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

export const categoryNames: Record<string, string> = {
  network: "Networking",
  compute: "Compute",
  security: "Seguridad",
  storage: "Storage",
  database: "Database",
  loadbalancer: "Load balancing",
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
  };
  return names[type] ?? type.replace(/^aws_/, "").replaceAll("_", " ");
}
