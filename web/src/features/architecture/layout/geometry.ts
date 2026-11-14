import type { Resource } from "../../../lib/types";
import type { ResourceNode } from "../graph";

/**
 * Loose nodes are laid out in lanes: resources, data sources and modules
 * (0), then providers, variables, locals and outputs.
 */
const lanes: Partial<Record<Resource["block"], number>> = {
  provider: 1,
  variable: 2,
  local: 3,
  output: 4,
};
export const laneOf = (r: Resource) => lanes[r.block] ?? 0;

/** Shared measures of the diagram layouts. */
export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point, Size {}

export const LEAF: Size = { width: 214, height: 96 };
/** Where children start inside a VPC or subnet (below its heading). */
export const CONTENT: Point = { x: 24, y: 68 };
/** Where top-level nodes start. */
export const ROOT: Point = { x: 20, y: 30 };
export const PAD = { right: 22, bottom: 20 };
/** Space kept between sibling nodes. */
export const GAP = { x: 32, y: 24 };
/** Two siblings closer than this count as overlapping. */
export const MARGIN = 8;

export const isVpc = (node: ResourceNode) =>
  node.data.resource.type === "aws_vpc";

export function minSize(node: ResourceNode): Size {
  if (node.type !== "scope") return LEAF;
  return isVpc(node)
    ? { width: 300, height: 200 }
    : { width: 262, height: 166 };
}

export function sizeOf(node: ResourceNode): Size {
  const width = Number(node.style?.width),
    height = Number(node.style?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width && height
    ? { width, height }
    : minSize(node);
}

/** A container's size: its minimum, or the frame of its children plus padding. */
export function fitFrame(node: ResourceNode, children: Iterable<Rect>): Size {
  const min = minSize(node);
  let width = min.width,
    height = min.height;
  for (const child of children) {
    width = Math.max(width, child.x + child.width + PAD.right);
    height = Math.max(height, child.y + child.height + PAD.bottom);
  }
  return { width, height };
}

export function overlaps(a: Rect, b: Rect, margin = MARGIN): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

/** Children by parent id (`undefined` for the top level), in node order. */
export function childrenByParent(nodes: ResourceNode[]) {
  const children = new Map<string | undefined, ResourceNode[]>();
  for (const node of nodes) {
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  }
  return children;
}

/**
 * Containers from the deepest to the top level, then `undefined` for the
 * top level itself: each container is laid out after its children.
 */
export function bottomUp(nodes: ResourceNode[]): (string | undefined)[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const depthOf = (node: ResourceNode, guard = 0): number => {
    const known = depth.get(node.id);
    if (known !== undefined) return known;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const d = parent && guard < 64 ? depthOf(parent, guard + 1) + 1 : 0;
    depth.set(node.id, d);
    return d;
  };
  const scopes = nodes.filter((n) => n.type === "scope");
  scopes.forEach((n) => depthOf(n));
  return [
    ...scopes
      .map((n, i) => ({ id: n.id, d: depth.get(n.id)!, i }))
      .sort((a, b) => b.d - a.d || a.i - b.i)
      .map((s) => s.id),
    undefined,
  ];
}
