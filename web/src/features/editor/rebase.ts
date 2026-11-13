/**
 * Line-based three-way merge used to keep a draft on top of a file that
 * changed on disk. Changes on both sides that touch the same or adjacent
 * lines are a conflict: they are never resolved silently.
 */

/** Replace `base[start, end)` with `lines`. */
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

export type RebaseResult =
  | { clean: true; text: string }
  /** `text` holds both versions between conflict markers. */
  | { clean: false; text: string; conflicts: number };

/** Above this many differing lines the diff gives up and reports a conflict. */
const MAX_EDITS = 2000;

/** Split keeping each line's terminator, so joining restores the text. */
export function splitLines(text: string): string[] {
  return text === "" ? [] : text.split(/(?<=\n)/);
}

/** Myers diff of two line lists, as hunks over `a`; null if too different. */
function diff(a: string[], b: string[]): Hunk[] | null {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0)
    return [{ start: head, end: head + n, lines: b.slice(head, head + m) }];
  const at = (i: number) => a[head + i];
  const bt = (j: number) => b[head + j];
  const limit = Math.min(n + m, MAX_EDITS);
  // trace[d] is the furthest x per diagonal k in [-d, d] after step d.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    const previous = trace[d - 1];
    const read = (k: number) => previous[k + d - 1];
    const v = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      let x =
        d === 0
          ? 0
          : k === -d || (k !== d && read(k - 1) < read(k + 1))
            ? read(k + 1)
            : read(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && at(x) === bt(y)) {
        x++;
        y++;
      }
      v[k + d] = x;
      if (x >= n && y >= m) found = d;
    }
    trace.push(v);
  }
  if (found < 0) return null;
  // Walk back to collect the matching line pairs.
  const matches: [number, number][] = [];
  let x = n,
    y = m;
  for (let d = found; d > 0; d--) {
    const previous = trace[d - 1];
    const read = (k: number) => previous[k + d - 1];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && read(k - 1) < read(k + 1)) ? k + 1 : k - 1;
    const prevX = read(prevK);
    const prevY = prevX - prevK;
    const startX = prevK === k + 1 ? prevX : prevX + 1;
    while (x > startX) matches.push([--x, --y]);
    x = prevX;
    y = prevY;
  }
  while (x > 0) matches.push([--x, --y]);
  matches.reverse();
  const hunks: Hunk[] = [];
  let i = 0,
    j = 0;
  for (const [mi, mj] of [...matches, [n, m] as [number, number]]) {
    if (mi > i || mj > j)
      hunks.push({
        start: head + i,
        end: head + mi,
        lines: b.slice(head + j, head + mj),
      });
    i = mi + 1;
    j = mj + 1;
  }
  return hunks;
}

/** Base lines in [start, end) with one side's hunks applied. */
function region(base: string[], start: number, end: number, hunks: Hunk[]) {
  const out: string[] = [];
  let at = start;
  for (const hunk of hunks) {
    out.push(...base.slice(at, hunk.start), ...hunk.lines);
    at = hunk.end;
  }
  out.push(...base.slice(at, end));
  return out.join("");
}

const terminated = (text: string) =>
  text === "" || text.endsWith("\n") ? text : text + "\n";

/**
 * Apply the changes from `base` to `mine` on top of `theirs` (the new file on
 * disk). Clean only when no change of one side touches a change of the other.
 */
export function rebase(
  base: string,
  mine: string,
  theirs: string,
): RebaseResult {
  if (mine === base || mine === theirs) return { clean: true, text: theirs };
  if (theirs === base) return { clean: true, text: mine };
  const baseLines = splitLines(base);
  const ours = diff(baseLines, splitLines(mine));
  const other = diff(baseLines, splitLines(theirs));
  if (!ours || !other) return conflict(mine, theirs);
  const all = [
    ...ours.map((h) => ({ ...h, side: 0 })),
    ...other.map((h) => ({ ...h, side: 1 })),
  ].sort((p, q) => p.start - q.start || p.side - q.side);
  let text = "";
  let at = 0;
  let conflicts = 0;
  for (let c = 0; c < all.length;) {
    // A cluster is a run of hunks that overlap or touch.
    const start = all[c].start;
    let end = all[c].end;
    const cluster = [all[c++]];
    while (c < all.length && all[c].start <= end) {
      end = Math.max(end, all[c].end);
      cluster.push(all[c++]);
    }
    text += baseLines.slice(at, start).join("");
    at = end;
    const mineHunks = cluster.filter((h) => h.side === 0);
    const theirHunks = cluster.filter((h) => h.side === 1);
    const mineText = region(baseLines, start, end, mineHunks);
    const theirText = region(baseLines, start, end, theirHunks);
    if (!theirHunks.length || mineText === theirText) text += mineText;
    else if (!mineHunks.length) text += theirText;
    else {
      conflicts++;
      text += markers(mineText, theirText);
    }
  }
  text += baseLines.slice(at).join("");
  return conflicts ? { clean: false, text, conflicts } : { clean: true, text };
}

function markers(mine: string, theirs: string) {
  return `<<<<<<< tu borrador\n${terminated(mine)}=======\n${terminated(theirs)}>>>>>>> disco\n`;
}

function conflict(mine: string, theirs: string): RebaseResult {
  return { clean: false, text: markers(mine, theirs), conflicts: 1 };
}
