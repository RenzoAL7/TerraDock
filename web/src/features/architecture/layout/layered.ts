import { Graph, layout } from "@dagrejs/dagre";
import type { Edge } from "@xyflow/react";
import type { ResourceNode } from "../graph";
import {
  bottomUp,
  childrenByParent,
  CONTENT,
  fitFrame,
  GAP,
  laneOf,
  LEAF,
  ROOT,
  type Point,
  type Size,
} from "./geometry";

/** Space between ranks and between the columns of a rank. */
const RANK_SEP = 48;
const NODE_SEP = GAP.x;
/** Lanes 1-3 (providers, variables, locals) go left; outputs (4) right. */
const LEFT_LANES = [1, 2, 3];
const RIGHT_LANE = 4;
const LANE_SEP = 48;
/** Width/height ratio the packed rows of disconnected parts aim for. */
const ASPECT = 1.6;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Part {
  ids: string[];
  positions: Map<string, Point>;
  width: number;
  height: number;
}

/**
 * The node `id` and its containers, up to the top level. A broken or cyclic
 * chain stops after 64 steps instead of looping.
 */
function chain(id: string, parentOf: Map<string, string | undefined>) {
  const ids = [id];
  let current = parentOf.get(id);
  while (current !== undefined && ids.length < 64 && parentOf.has(current)) {
    ids.push(current);
    current = parentOf.get(current);
  }
  return ids;
}

/**
 * References as edges between siblings: an edge between nodes in different
 * containers is lifted to the children of their closest common container.
 * An edge between a node and one of its own containers has no siblings to
 * connect and is skipped.
 */
export function liftEdges(
  nodes: ResourceNode[],
  edges: Pick<Edge, "source" | "target">[],
): Map<string | undefined, [string, string][]> {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const lifted = new Map<string | undefined, Map<string, [string, string]>>();
  for (const { source, target } of edges) {
    if (!parentOf.has(source) || !parentOf.has(target)) continue;
    const up = chain(source, parentOf),
      down = chain(target, parentOf);
    const containersOfTarget = new Set(down.slice(1));
    // The deepest container of both; undefined is the top level.
    const common = up.slice(1).find((id) => containersOfTarget.has(id));
    const a = common === undefined ? up.at(-1)! : up[up.indexOf(common) - 1];
    const b =
      common === undefined ? down.at(-1)! : down[down.indexOf(common) - 1];
    if (a === b) continue;
    const pairs = lifted.get(common) ?? new Map<string, [string, string]>();
    pairs.set(`${a}\u0000${b}`, [a, b]);
    lifted.set(common, pairs);
  }
  return new Map(
    [...lifted].map(([key, pairs]) => [
      key,
      [...pairs.values()].sort(
        (x, y) => byText(x[0], y[0]) || byText(x[1], y[1]),
      ),
    ]),
  );
}

/** Connected parts of the siblings, each laid out top to bottom with dagre. */
function layoutParts(
  ids: string[],
  sizes: Map<string, Size>,
  pairs: [string, string][],
): Part[] {
  const root = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let r = id;
    while (root.get(r) !== r) r = root.get(r)!;
    root.set(id, r);
    return r;
  };
  for (const [a, b] of pairs) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) root.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    const list = groups.get(r);
    if (list) list.push(id);
    else groups.set(r, [id]);
  }
  const partOf = new Map<string, string>();
  for (const [r, list] of groups) for (const id of list) partOf.set(id, r);
  const pairsOf = new Map<string, [string, string][]>();
  for (const pair of pairs) {
    const r = partOf.get(pair[0])!;
    const list = pairsOf.get(r);
    if (list) list.push(pair);
    else pairsOf.set(r, [pair]);
  }
  return [...groups].map(([r, members]) => {
    if (members.length === 1) {
      const size = sizes.get(members[0])!;
      return {
        ids: members,
        positions: new Map([[members[0], { x: 0, y: 0 }]]),
        ...size,
      };
    }
    const g = new Graph();
    g.setGraph({
      rankdir: "TB",
      nodesep: NODE_SEP,
      ranksep: RANK_SEP,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const id of members) g.setNode(id, { ...sizes.get(id)! });
    for (const [a, b] of pairsOf.get(r) ?? []) g.setEdge(a, b);
    layout(g);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const centers = new Map<string, Point>();
    for (const id of members) {
      const { x, y } = g.node(id);
      const { width, height } = sizes.get(id)!;
      centers.set(id, { x, y });
      minX = Math.min(minX, x - width / 2);
      minY = Math.min(minY, y - height / 2);
      maxX = Math.max(maxX, x + width / 2);
      maxY = Math.max(maxY, y + height / 2);
    }
    const positions = new Map<string, Point>();
    for (const id of members) {
      const c = centers.get(id)!;
      const { width, height } = sizes.get(id)!;
      positions.set(id, {
        x: Math.round(c.x - width / 2 - minX),
        y: Math.round(c.y - height / 2 - minY),
      });
    }
    return {
      ids: members,
      positions,
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    };
  });
}

/**
 * Packs parts in rows from `origin`, largest first, in rows about ASPECT
 * times wider than tall. Returns the right edge used.
 */
function pack(parts: Part[], origin: Point, out: Map<string, Point>): number {
  if (!parts.length) return origin.x;
  const sorted = [...parts].sort(
    (a, b) =>
      b.ids.length - a.ids.length ||
      b.height - a.height ||
      byText(a.ids[0], b.ids[0]),
  );
  const area = sorted.reduce(
    (sum, p) => sum + (p.width + GAP.x) * (p.height + GAP.y),
    0,
  );
  const rowWidth = Math.max(
    ...sorted.map((p) => p.width),
    Math.sqrt(area * ASPECT),
  );
  let x = 0,
    y = 0,
    rowHeight = 0,
    right = 0;
  for (const part of sorted) {
    if (x > 0 && x + part.width > rowWidth) {
      x = 0;
      y += rowHeight + GAP.y;
      rowHeight = 0;
    }
    for (const [id, p] of part.positions)
      out.set(id, { x: origin.x + x + p.x, y: origin.y + y + p.y });
    right = Math.max(right, x + part.width);
    x += part.width + GAP.x;
    rowHeight = Math.max(rowHeight, part.height);
  }
  return origin.x + right;
}

/**
 * Layered layout: references run top to bottom inside each container. The
 * containers are laid out from the innermost (subnets) to the top level,
 * each as a single box for its parent; dagre's compound mode is not used.
 * At the top level, providers, variables and locals keep their own columns
 * on the left and outputs on the right, ordered by where their neighbors
 * are. The input order does not change the result.
 */
export function layeredLayout(
  nodes: ResourceNode[],
  edges: Pick<Edge, "source" | "target">[],
): ResourceNode[] {
  const children = childrenByParent(nodes);
  const lifted = liftEdges(nodes, edges);
  const sizes = new Map<string, Size>();
  const positions = new Map<string, Point>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sizeOf = (n: ResourceNode) =>
    sizes.get(n.id) ?? (n.type === "scope" ? fitFrame(n, []) : LEAF);
  const isLane = (n: ResourceNode) =>
    !n.parentId && n.type !== "scope" && laneOf(n.data.resource) > 0;

  for (const container of bottomUp(nodes)) {
    const kids = (children.get(container) ?? [])
      .filter((n) => container !== undefined || !isLane(n))
      .sort((a, b) => byText(a.id, b.id));
    const kidSizes = new Map(kids.map((n) => [n.id, sizeOf(n)]));
    const ids = new Set(kids.map((n) => n.id));
    const pairs = (lifted.get(container) ?? []).filter(
      ([a, b]) => ids.has(a) && ids.has(b),
    );
    const parts = layoutParts(
      kids.map((n) => n.id),
      kidSizes,
      pairs,
    );
    if (container === undefined) {
      const lanes = nodes.filter(isLane);
      const left = LEFT_LANES.filter((lane) =>
        lanes.some((n) => laneOf(n.data.resource) === lane),
      );
      const start = {
        x: ROOT.x + left.length * (LEAF.width + LANE_SEP),
        y: ROOT.y,
      };
      const right = pack(parts, start, positions);
      placeLanes(lanes, left, right, edges, positions, sizes, byId);
    } else {
      pack(parts, CONTENT, positions);
      const node = byId.get(container)!;
      sizes.set(
        container,
        fitFrame(
          node,
          kids.map((n) => ({
            ...positions.get(n.id)!,
            ...kidSizes.get(n.id)!,
          })),
        ),
      );
    }
  }
  return nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? { x: ROOT.x, y: ROOT.y },
    style: sizeOf(n),
  }));
}

/** Absolute center of a laid-out node, adding its containers' positions. */
function center(
  id: string,
  positions: Map<string, Point>,
  sizes: Map<string, Size>,
  byId: Map<string, ResourceNode>,
): Point | undefined {
  const node = byId.get(id);
  const own = positions.get(id);
  if (!node || !own) return undefined;
  let x = own.x,
    y = own.y,
    parent = node.parentId,
    guard = 0;
  while (parent && guard++ < 64) {
    const p = positions.get(parent);
    if (!p) return undefined;
    x += p.x;
    y += p.y;
    parent = byId.get(parent)?.parentId;
  }
  const size = sizes.get(id) ?? LEAF;
  return { x: x + size.width / 2, y: y + size.height / 2 };
}

function placeLanes(
  lanes: ResourceNode[],
  left: number[],
  mainRight: number,
  edges: Pick<Edge, "source" | "target">[],
  positions: Map<string, Point>,
  sizes: Map<string, Size>,
  byId: Map<string, ResourceNode>,
) {
  const laneIds = new Set(lanes.map((n) => n.id));
  const neighbors = new Map<string, string[]>();
  for (const { source, target } of edges) {
    if (laneIds.has(source) && !laneIds.has(target))
      neighbors.set(source, [...(neighbors.get(source) ?? []), target]);
    if (laneIds.has(target) && !laneIds.has(source))
      neighbors.set(target, [...(neighbors.get(target) ?? []), source]);
  }
  const columns = [
    ...left.map((lane, i) => ({
      lane,
      x: ROOT.x + i * (LEAF.width + LANE_SEP),
    })),
    { lane: RIGHT_LANE, x: mainRight + LANE_SEP },
  ];
  for (const { lane, x } of columns) {
    const items = lanes
      .filter((n) => laneOf(n.data.resource) === lane)
      .map((n) => {
        const ys = (neighbors.get(n.id) ?? [])
          .map((id) => center(id, positions, sizes, byId)?.y)
          .filter((y): y is number => y !== undefined);
        return {
          id: n.id,
          bary: ys.length
            ? ys.reduce((a, b) => a + b, 0) / ys.length
            : Infinity,
        };
      })
      .sort((a, b) => a.bary - b.bary || byText(a.id, b.id));
    let bottom = ROOT.y - GAP.y;
    for (const item of items) {
      const want = Number.isFinite(item.bary)
        ? item.bary - LEAF.height / 2
        : bottom + GAP.y;
      const y = Math.round(Math.max(want, bottom + GAP.y, ROOT.y));
      positions.set(item.id, { x, y });
      bottom = y + LEAF.height;
    }
  }
}
