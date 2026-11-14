// Test helpers for the layouts. Imported only by *.test.ts files.
import type { Resource, ResourceEdge } from "../../../lib/types";
import type { ResourceNode } from "../graph";

const blocks: Record<string, Resource["block"]> = {
  var: "variable",
  local: "local",
  output: "output",
  provider: "provider",
};

export function resource(id: string, parentId?: string): Resource {
  const [type, name] = id.split(".");
  return {
    id,
    block: blocks[type] ?? "resource",
    type,
    name,
    label: name,
    file: "main.tf",
    line: 1,
    category: "other",
    properties: [],
    dependsOn: [],
    parentId,
  };
}

export function reference(source: string, target: string): ResourceEdge {
  return {
    id: `${source}:${target}`,
    source,
    target,
    label: "ref",
    kind: "reference",
  };
}

/**
 * Like the e2e project: per VPC a subnet, a group and an instance that uses
 * both, plus a variable per 20 resources and an output per 40.
 */
export function largeProject(count: number) {
  const resources: Resource[] = [];
  const edges: ResourceEdge[] = [];
  for (let i = 0; i < count; i++) {
    const vpc = `aws_vpc.v${Math.floor(i / 4) * 4}`;
    if (i % 4 === 0) resources.push(resource(`aws_vpc.v${i}`));
    else if (i % 4 === 1) resources.push(resource(`aws_subnet.s${i}`, vpc));
    else if (i % 4 === 2)
      resources.push(resource(`aws_security_group.g${i}`, vpc));
    else {
      resources.push(resource(`aws_instance.i${i}`, `aws_subnet.s${i - 2}`));
      edges.push(
        reference(`aws_security_group.g${i - 1}`, `aws_instance.i${i}`),
      );
      if (i % 20 === 3) {
        resources.push(resource(`var.size${i}`));
        edges.push(reference(`var.size${i}`, `aws_instance.i${i}`));
      }
      if (i % 40 === 3) {
        resources.push(resource(`output.ip${i}`));
        edges.push(reference(`aws_instance.i${i}`, `output.ip${i}`));
      }
    }
  }
  return { resources, edges };
}

/** Deterministic shuffle (mulberry32), so a failure can be repeated. */
export function shuffled<T>(items: T[], seed = 7): T[] {
  let a = seed;
  const random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const rectOf = (n: ResourceNode) => ({
  x: n.position.x,
  y: n.position.y,
  width: Number(n.style?.width),
  height: Number(n.style?.height),
});

/** Pairs of siblings whose boxes intersect. */
export function overlapping(nodes: ResourceNode[]): string[] {
  const groups = new Map<string, ResourceNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const found: string[] = [];
  for (const list of groups.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = rectOf(list[i]),
          b = rectOf(list[j]);
        if (
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
        )
          found.push(`${list[i].id} ↔ ${list[j].id}`);
      }
  return found;
}

/** Children that stick out of their container. */
export function outside(nodes: ResourceNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes
    .filter((n) => n.parentId)
    .filter((n) => {
      const c = rectOf(n),
        p = rectOf(byId.get(n.parentId!)!);
      return (
        c.x < 0 ||
        c.y < 0 ||
        c.x + c.width > p.width ||
        c.y + c.height > p.height
      );
    })
    .map((n) => n.id);
}

/** Absolute center of every node. */
export function centers(nodes: ResourceNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    let x = n.position.x,
      y = n.position.y,
      p = n.parentId;
    while (p) {
      const parent = byId.get(p)!;
      x += parent.position.x;
      y += parent.position.y;
      p = parent.parentId;
    }
    const r = rectOf(n);
    out.set(n.id, { x: x + r.width / 2, y: y + r.height / 2 });
  }
  return out;
}

export const positionsById = (nodes: ResourceNode[]) =>
  Object.fromEntries(nodes.map((n) => [n.id, n.position]));
