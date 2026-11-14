import type { Edge } from "@xyflow/react";
import type { ResourceNode } from "../graph";
import {
  bottomUp,
  childrenByParent,
  CONTENT,
  fitFrame,
  GAP,
  LEAF,
  MARGIN,
  overlaps,
  ROOT,
  sizeOf,
  type Point,
  type Rect,
  type Size,
} from "./geometry";

/** Where a node was when it disappeared, to put it back if it returns. */
export interface Placement {
  parentId?: string;
  type: string;
  position: Point;
}
export type Remembered = Map<string, Placement>;
const REMEMBER = 2000;

/**
 * Places the nodes of a freshly built graph (`next`) without moving what the
 * user already sees (`prev`). It never lays the whole diagram out again:
 *
 * - A node that existed in the same container keeps its position, also when
 *   it is renamed: a node that disappears and one of the same type that
 *   appears in the same container in the same update take the same place.
 * - A node that comes back (undo, a block cut and pasted back) returns to
 *   where it was, if that place is still free.
 * - Any other new node goes to the first free place in its container next
 *   to its first neighbor (below it), or in reading order if it has none.
 *   The children of a new container keep the arrangement they came with.
 * - Each container fits the frame of its children. If it grows, only the
 *   siblings it now overlaps are pushed (down, or right if they were to its
 *   right), and so on up the containers.
 *
 * `remembered` collects the places of removed nodes; the caller keeps it
 * between updates. Calling it twice with the same input gives the same
 * result, which keeps it safe inside a React state updater.
 */
export function stabilize(
  prev: ResourceNode[],
  next: ResourceNode[],
  edges: Pick<Edge, "source" | "target">[],
  remembered: Remembered = new Map(),
): ResourceNode[] {
  if (!prev.length) return next;
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const nextById = new Map(next.map((n) => [n.id, n]));
  const type = (n: ResourceNode) => n.data.resource.type;

  // Renames: removed and added nodes of the same type in the same container.
  const renamedFrom = new Map<string, string>();
  const pool = new Map<string, string[]>();
  for (const n of prev)
    if (!nextById.has(n.id)) {
      const key = `${type(n)}\u0000${n.parentId ?? ""}`;
      const list = pool.get(key);
      if (list) list.push(n.id);
      else pool.set(key, [n.id]);
    }
  const oldParent = (n: ResourceNode) =>
    n.parentId ? (renamedFrom.get(n.parentId) ?? n.parentId) : undefined;
  // `next` lists parents first, so a renamed container is known before its
  // children are matched.
  for (const n of next) {
    if (prevById.has(n.id)) continue;
    const list = pool.get(`${type(n)}\u0000${oldParent(n) ?? ""}`);
    const old = list?.shift();
    if (old) renamedFrom.set(n.id, old);
  }
  const inherited = new Set(renamedFrom.values());
  for (const n of prev)
    if (!nextById.has(n.id) && !inherited.has(n.id)) {
      remembered.delete(n.id);
      remembered.set(n.id, {
        parentId: n.parentId,
        type: type(n),
        position: n.position,
      });
    }
  // Entries of nodes that are back stay: they are only read when that id is
  // added again, and rewritten when it is removed again. Not deleting them
  // keeps a second call with the same input (React may call an updater
  // twice) giving the same result.
  for (const id of remembered.keys()) {
    if (remembered.size <= REMEMBER) break;
    remembered.delete(id);
  }

  const before = (n: ResourceNode) => {
    const p = prevById.get(n.id) ?? prevById.get(renamedFrom.get(n.id) ?? "");
    return p && p.parentId === oldParent(n) ? p : undefined;
  };
  const neighbors = new Map<string, string[]>();
  for (const { source, target } of edges) {
    if (source === target) continue;
    neighbors.set(source, [...(neighbors.get(source) ?? []), target]);
    neighbors.set(target, [...(neighbors.get(target) ?? []), source]);
  }
  const children = childrenByParent(next);
  const position = new Map<string, Point>();
  const size = new Map<string, Size>();
  const sizeIn = (n: ResourceNode) =>
    n.type === "scope" ? (size.get(n.id) ?? sizeOf(n)) : sizeOf(n);

  for (const container of bottomUp(next)) {
    const kids = children.get(container) ?? [];
    const parent =
      container === undefined ? undefined : nextById.get(container);
    const kept = container === undefined || !!(parent && before(parent));
    const rects = new Map<string, Rect>();
    const grown: { id: string; width: number }[] = [];
    const pending: ResourceNode[] = [];
    for (const kid of kids) {
      const own = sizeIn(kid);
      const old = before(kid);
      if (old) {
        rects.set(kid.id, { ...old.position, ...own });
        const was = sizeOf(old);
        if (own.width > was.width || own.height > was.height)
          grown.push({ id: kid.id, width: was.width });
      } else if (!kept) {
        rects.set(kid.id, { ...kid.position, ...own });
      } else pending.push(kid);
    }
    pushApart(rects, grown);
    const origin = container === undefined ? ROOT : CONTENT;
    const maxRight =
      container === undefined || !parent
        ? Infinity
        : Math.max(
            sizeOf(before(parent) ?? parent).width - 22,
            origin.x + LEAF.width,
          );
    for (const kid of pending) {
      const own = sizeIn(kid);
      const back = remembered.get(kid.id);
      const anchor =
        back && back.parentId === kid.parentId && back.type === type(kid)
          ? back.position
          : besideNeighbor(kid, container, rects, neighbors, nextById);
      const spot = findSlot(own, rects, origin, maxRight, anchor);
      rects.set(kid.id, { ...spot, ...own });
    }
    for (const [id, r] of rects) position.set(id, { x: r.x, y: r.y });
    if (parent) size.set(parent.id, fitFrame(parent, rects.values()));
  }
  return next.map((n) => ({
    ...n,
    position: position.get(n.id) ?? n.position,
    style: n.type === "scope" ? (size.get(n.id) ?? sizeOf(n)) : n.style,
  }));
}

/**
 * Where to start looking for a new node's place: right below its first
 * neighbor that is already placed in the same container (or below the
 * sibling that holds that neighbor).
 */
function besideNeighbor(
  node: ResourceNode,
  container: string | undefined,
  rects: Map<string, Rect>,
  neighbors: Map<string, string[]>,
  byId: Map<string, ResourceNode>,
): Point | undefined {
  for (const id of neighbors.get(node.id) ?? []) {
    let current = byId.get(id),
      guard = 0;
    while (current && current.parentId !== container && guard++ < 64)
      current = current.parentId ? byId.get(current.parentId) : undefined;
    if (!current || current.id === node.id) continue;
    const rect = rects.get(current.id);
    if (rect) return { x: rect.x, y: rect.y + rect.height + GAP.y };
  }
  return undefined;
}

/**
 * A free place for a box of `size`: around `anchor` (closest rings first,
 * below before above), or else the first free cell in reading order.
 */
export function findSlot(
  size: Size,
  rects: Map<string, Rect>,
  origin: Point,
  maxRight: number,
  anchor?: Point,
): Point {
  const taken = [...rects.values()];
  const stepX = size.width + GAP.x,
    stepY = size.height + GAP.y;
  const fits = (x: number, y: number) =>
    x >= origin.x &&
    y >= origin.y &&
    (x + size.width <= maxRight || x === origin.x) &&
    !taken.some((r) => overlaps({ x, y, ...size }, r, MARGIN));
  if (anchor) {
    const start = {
      x: Math.max(origin.x, anchor.x),
      y: Math.max(origin.y, anchor.y),
    };
    for (let ring = 0; ring <= 24; ring++) {
      const cells: [number, number][] = [];
      for (let j = -ring; j <= ring; j++)
        for (let i = -ring; i <= ring; i++)
          if (Math.max(Math.abs(i), Math.abs(j)) === ring) cells.push([i, j]);
      cells.sort(
        ([ai, aj], [bi, bj]) =>
          Number(aj < 0) - Number(bj < 0) ||
          Math.abs(ai) + Math.abs(aj) - Math.abs(bi) - Math.abs(bj) ||
          Math.abs(ai) - Math.abs(bi) ||
          aj - bj ||
          ai - bi,
      );
      for (const [i, j] of cells) {
        const x = start.x + i * stepX,
          y = start.y + j * stepY;
        if (fits(x, y)) return { x, y };
      }
    }
  }
  const right = Number.isFinite(maxRight)
    ? maxRight
    : Math.max(origin.x + size.width, ...taken.map((r) => r.x + r.width));
  const columns = Math.max(1, Math.floor((right - origin.x + GAP.x) / stepX));
  for (let row = 0; ; row++)
    for (let col = 0; col < columns; col++) {
      const x = origin.x + col * stepX,
        y = origin.y + row * stepY;
      if (fits(x, y)) return { x, y };
    }
}

/**
 * Pushes the siblings a grown container now overlaps: right if they were
 * entirely to its right before, down otherwise. A pushed sibling may push
 * others in turn; nothing else moves.
 */
function pushApart(
  rects: Map<string, Rect>,
  grown: { id: string; width: number }[],
) {
  const oldWidth = new Map(grown.map((g) => [g.id, g.width]));
  const queue = grown.map((g) => g.id);
  let guard = 0;
  while (queue.length && guard++ < 10_000) {
    const id = queue.shift()!;
    const g = rects.get(id)!;
    const oldRight = g.x + (oldWidth.get(id) ?? g.width);
    for (const [other, s] of rects) {
      if (other === id || !overlaps(g, s, MARGIN)) continue;
      if (s.x >= oldRight) s.x = g.x + g.width + GAP.x;
      else s.y = g.y + g.height + GAP.y;
      queue.push(other);
    }
  }
}
