import type { Resource } from "../lib/types";

/**
 * Last line of the HCL block that starts at `startLine`, found by matching
 * braces outside strings and comments. Good enough to link editor lines with
 * diagram nodes; it is not a parser and falls back to the start line.
 */
export function blockEnd(content: string, startLine: number): number {
  const lines = content.split("\n");
  let depth = 0,
    opened = false,
    inString = false,
    inBlockComment = false;
  for (let i = startLine - 1; i < lines.length; i++) {
    const text = lines[i] ?? "";
    for (let j = 0; j < text.length; j++) {
      const c = text[j],
        next = text[j + 1];
      if (inBlockComment) {
        if (c === "*" && next === "/") {
          inBlockComment = false;
          j++;
        }
        continue;
      }
      if (inString) {
        if (c === "\\") j++;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "#" || (c === "/" && next === "/")) break;
      else if (c === "/" && next === "*") {
        inBlockComment = true;
        j++;
      } else if (c === "{") {
        depth++;
        opened = true;
      } else if (c === "}") {
        depth--;
        if (opened && depth === 0) return i + 1;
      }
    }
    if (inString) inString = false; // unterminated: do not leak across lines
  }
  return startLine;
}

/** The resource whose block (in `file`) contains `line`, if any. */
export function resourceAtLine(
  resources: Resource[],
  file: string,
  content: string,
  line: number,
): Resource | undefined {
  return resources
    .filter((r) => r.file === file && r.line <= line)
    .sort((a, b) => b.line - a.line)
    .find((r) => blockEnd(content, r.line) >= line);
}
