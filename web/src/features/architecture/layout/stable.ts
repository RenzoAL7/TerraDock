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
import { layeredLayout } from "./layered";

/** Where a node was when it disappeared, to put it back if it returns. */
export interface Placement {
  parentId?: string;
  type: string;
  position: Point;
}
export type Remembered = Map<string, Placement>;
const REMEMBER = 2000;

/** Fewer new nodes than this never start a new layout. */
const MIN_FRESH = 10;

/**
 * Whether an update brings a different diagram instead of editing the one on
 * screen: a `git checkout` to another branch, a large file pasted into a
 * small project. It does when the nodes that are really new (neither on
 * screen nor in `returning`, the places of removed nodes) are at least ten
 * and outnumber those that stay. Removing nodes never does, so cutting most
 * of the diagram and pasting it back, or undoing a large deletion, puts each
 * node back where it was. Ids decide, so renaming most nodes at once counts
 * as new nodes. An empty diagram is always laid out.
 */
export function replacesDiagram(
  prev: { id: string }[],
  next: { id: string }[],
  returning: { has(id: string): boolean } = new Map(),
): boolean {
  if (!prev.length) return true;
  const before = new Set(prev.map((n) => n.id));
  let kept = 0,
    fresh = 0;
  for (const n of next)
    if (before.has(n.id)) kept++;
    else if (!returning.has(n.id)) fresh++;
  return fresh >= MIN_FRESH && fresh > kept;
}

/**
 * What the canvas does on every update after the first layout: keep the
 * places (`stabilize`), or lay the diagram out in layers again when the
 * update replaces it (`replacesDiagram`). A new layout starts from scratch:
 * the remembered places belong to the old one, so they are forgotten.
 */
export function placeUpdate(
  prev: ResourceNode[],
  next: ResourceNode[],
  edges: Pick<Edge, "source" | "target">[],
  remembered: Remembered,
): ResourceNode[] {
  if (!replacesDiagram(prev, next, remembered))
    return stabilize(prev, next, edges, remembered);
  remembered.clear();
  return layeredLayout(next, edges);
}

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
    // Built only when something has to be placed.
    let taken: Occupied | undefined;
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
      taken ??= new Occupied(rects.values());
      const spot = findSlot(own, taken, origin, maxRight, anchor);
      const rect = { ...spot, ...own };
      rects.set(kid.id, rect);
      taken.add(rect);
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

/** Side of the buckets of {@link Occupied}, about one card. */
const BUCKET = 256;
/** A box spanning more buckets than this is checked against every query. */
const WIDE = 256;

/**
 * The boxes already placed in a container, kept in buckets of a fixed grid:
 * finding out whether a place is free compares it with the boxes of a few
 * buckets, not with every sibling, so placing hundreds of new nodes at once
 * stays fast. It only grows while a container is being placed.
 */
class Occupied {
  private readonly buckets = new Map<string, Rect[]>();
  private readonly wide: Rect[] = [];
  /** The right edge of the rightmost box, for the reading order. */
  right = -Infinity;
  /**
   * Per box size and number of columns, the first cell of the reading order
   * that may still be free: cells only fill up, so the scan resumes there.
   */
  readonly resume = new Map<string, number>();

  constructor(rects: Iterable<Rect>) {
    for (const rect of rects) this.add(rect);
  }

  add(rect: Rect) {
    this.right = Math.max(this.right, rect.x + rect.width);
    const [x0, x1, y0, y1] = span(rect, 0);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > WIDE) {
      this.wide.push(rect);
      return;
    }
    for (let bx = x0; bx <= x1; bx++)
      for (let by = y0; by <= y1; by++) {
        const key = `${bx}:${by}`;
        const list = this.buckets.get(key);
        if (list) list.push(rect);
        else this.buckets.set(key, [rect]);
      }
  }

  /** Whether `rect` comes closer than MARGIN to a placed box. */
  collides(rect: Rect): boolean {
    if (this.wide.some((other) => overlaps(rect, other, MARGIN))) return true;
    const [x0, x1, y0, y1] = span(rect, MARGIN);
    for (let bx = x0; bx <= x1; bx++)
      for (let by = y0; by <= y1; by++) {
        const list = this.buckets.get(`${bx}:${by}`);
        if (list?.some((other) => overlaps(rect, other, MARGIN))) return true;
      }
    return false;
  }
}

/** The buckets a box covers, widened by `margin` on every side. */
function span(rect: Rect, margin: number): [number, number, number, number] {
  return [
    Math.floor((rect.x - margin) / BUCKET),
    Math.floor((rect.x + rect.width + margin) / BUCKET),
    Math.floor((rect.y - margin) / BUCKET),
    Math.floor((rect.y + rect.height + margin) / BUCKET),
  ];
}

const RINGS = 24;
/**
 * The cells around an anchor, ring by ring: in each ring below before
 * above, then the closest first. The same for every search, so it is
 * computed once.
 */
const ringCells: [number, number][][] = Array.from(
  { length: RINGS + 1 },
  (_, ring) => {
    const cells: [number, number][] = [];
    for (let j = -ring; j <= ring; j++)
      for (let i = -ring; i <= ring; i++)
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) cells.push([i, j]);
    return cells.sort(
      ([ai, aj], [bi, bj]) =>
        Number(aj < 0) - Number(bj < 0) ||
        Math.abs(ai) + Math.abs(aj) - Math.abs(bi) - Math.abs(bj) ||
        Math.abs(ai) - Math.abs(bi) ||
        aj - bj ||
        ai - bi,
    );
  },
);

/**
 * A free place for a box of `size`: around `anchor` (closest rings first,
 * below before above), or else the first free cell in reading order.
 */
function findSlot(
  size: Size,
  taken: Occupied,
  origin: Point,
  maxRight: number,
  anchor?: Point,
): Point {
  const stepX = size.width + GAP.x,
    stepY = size.height + GAP.y;
  const fits = (x: number, y: number) =>
    x >= origin.x &&
    y >= origin.y &&
    (x + size.width <= maxRight || x === origin.x) &&
    !taken.collides({ x, y, ...size });
  if (anchor) {
    const start = {
      x: Math.max(origin.x, anchor.x),
      y: Math.max(origin.y, anchor.y),
    };
    for (const cells of ringCells)
      for (const [i, j] of cells) {
        const x = start.x + i * stepX,
          y = start.y + j * stepY;
        if (fits(x, y)) return { x, y };
      }
  }
  const right = Number.isFinite(maxRight)
    ? maxRight
    : Math.max(origin.x + size.width, taken.right);
  const columns = Math.max(1, Math.floor((right - origin.x + GAP.x) / stepX));
  const key = `${size.width}x${size.height}:${columns}`;
  for (let cell = taken.resume.get(key) ?? 0; ; cell++) {
    const x = origin.x + (cell % columns) * stepX,
      y = origin.y + Math.floor(cell / columns) * stepY;
    if (fits(x, y)) {
      taken.resume.set(key, cell + 1);
      return { x, y };
    }
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
