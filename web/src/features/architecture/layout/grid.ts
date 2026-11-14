import type { ResourceNode } from "../graph";
import {
  bottomUp,
  childrenByParent,
  fitFrame,
  laneOf,
  LEAF,
  type Point,
  type Size,
} from "./geometry";

/**
 * The fixed grid TerraDock used before the layered layout: subnets two per
 * row inside a VPC, resources below them, then top-level containers side by
 * side and loose nodes in columns of six, one lane after another. It is
 * linear and needs no library; stabilize() also uses it to arrange the
 * children of a container that appears while typing.
 */
export function gridLayout(nodes: ResourceNode[]): ResourceNode[] {
  const children = childrenByParent(nodes);
  const sizes = new Map<string, Size>();
  function measure(node: ResourceNode): Size {
    if (node.type !== "scope") return LEAF;
    const known = sizes.get(node.id);
    if (known) return known;
    const vpc = node.data.resource.type === "aws_vpc";
    const nested = children.get(node.id) ?? [];
    const groups = nested.filter((n) => n.type === "scope"),
      leaves = nested.filter((n) => n.type !== "scope");
    const groupHeight = groups.length
      ? Math.max(...groups.map((g) => measure(g).height))
      : 0;
    const columns = vpc ? 2 : 1;
    const height =
      72 +
      Math.ceil(groups.length / 2) * (groupHeight + 24) +
      Math.ceil(leaves.length / columns) * 116 +
      16;
    const size = {
      width: vpc ? 626 : 280,
      height: Math.max(vpc ? 220 : 166, height),
    };
    sizes.set(node.id, size);
    return size;
  }
  const positions = new Map<string, Point>();
  function place(node: ResourceNode, x: number, y: number) {
    positions.set(node.id, { x, y });
    const nested = children.get(node.id) ?? [];
    const groups = nested.filter((n) => n.type === "scope"),
      leaves = nested.filter((n) => n.type !== "scope");
    const rowHeight = groups.length
      ? Math.max(...groups.map((g) => measure(g).height)) + 24
      : 0;
    groups.forEach((g, i) =>
      place(g, 22 + (i % 2) * 302, 68 + Math.floor(i / 2) * rowHeight),
    );
    const start = 68 + Math.ceil(groups.length / 2) * rowHeight;
    const columns = node.data.resource.type === "aws_vpc" ? 2 : 1;
    leaves.forEach((leaf, i) =>
      place(
        leaf,
        24 + (i % columns) * 300,
        start + Math.floor(i / columns) * 116,
      ),
    );
  }
  const roots = children.get(undefined) ?? [];
  let x = 20;
  roots
    .filter((n) => n.type === "scope")
    .forEach((n) => {
      place(n, x, 30);
      x += measure(n).width + 42;
    });
  const loose = roots.filter((n) => n.type !== "scope");
  let column = 0;
  for (let lane = 0; lane <= 4; lane++) {
    const items = loose.filter((n) => laneOf(n.data.resource) === lane);
    items.forEach((n, i) =>
      place(n, x + (column + Math.floor(i / 6)) * 248, 44 + (i % 6) * 130),
    );
    column += Math.ceil(items.length / 6);
  }
  const placed = nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    style: n.type === "scope" ? measure(n) : LEAF,
  }));
  return fitContainers(placed);
}

/**
 * Sizes every container to the frame of its children, from the deepest up,
 * with the same rule stabilize() applies while typing, so laying out and
 * then stabilizing changes nothing.
 */
export function fitContainers(nodes: ResourceNode[]): ResourceNode[] {
  const children = childrenByParent(nodes);
  const sizes = new Map<string, Size>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of bottomUp(nodes)) {
    if (id === undefined) continue;
    const rects = (children.get(id) ?? []).map((c) => ({
      ...c.position,
      ...(sizes.get(c.id) ?? (c.type === "scope" ? fitOf(c) : LEAF)),
    }));
    sizes.set(id, fitFrame(byId.get(id)!, rects));
  }
  function fitOf(node: ResourceNode): Size {
    return sizes.get(node.id) ?? fitFrame(node, []);
  }
  return nodes.map((n) =>
    n.type === "scope" ? { ...n, style: sizes.get(n.id)! } : n,
  );
}
