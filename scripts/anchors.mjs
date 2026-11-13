// Finds links to Markdown headings (README.md#…, TerraDock#…, docs/*.md#…)
// and checks that each fragment matches a heading GitHub would generate.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const repository = "https://github.com/RenzoAL7/TerraDock";

/** GitHub-style slug: lowercase, punctuation removed, spaces to hyphens. */
export function slug(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images → text
    .replace(/[`*_~]/g, "") // inline code and emphasis markers
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} -]/gu, "")
    .replace(/ /g, "-");
}

/** Anchors of a Markdown document, numbering duplicates like GitHub. */
export function anchors(markdown) {
  const seen = new Map();
  const result = new Set();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = slug(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

/**
 * Links with a fragment in `content` of `file` (path relative to the repo),
 * as { target, fragment } with target relative to the repository root.
 */
export function fragmentLinks(file, content) {
  const links = [];
  const add = (target, fragment) =>
    links.push({ target, fragment: decodeURIComponent(fragment) });
  const fragment = "([^\\s)\"'`>]+)";
  for (const [, path, frag] of content.matchAll(
    new RegExp(
      `${repository.replace(/[./]/g, "\\$&")}(?:/blob/main/([\\w./-]+\\.md))?#${fragment}`,
      "g",
    ),
  ))
    // The repository page itself exposes #readme for the rendered README.
    if (path || frag !== "readme") add(path ?? "README.md", frag);
  if (file.endsWith(".md")) {
    for (const [, path, frag] of content.matchAll(
      new RegExp(`\\]\\(((?:[\\w./-]+\\.md)?)#${fragment}\\)`, "g"),
    ))
      add(
        path
          ? normalize(join(dirname(file), path)).replaceAll("\\", "/")
          : file,
        frag,
      );
  }
  return links;
}

function walk(root, dir, accept, files = []) {
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) {
      if (name !== "node_modules" && name !== "generated")
        walk(root, path, accept, files);
    } else if (accept(name)) files.push(path);
  }
  return files;
}

/** Every broken fragment link under README, CONTRIBUTING, docs/ and web/src/. */
export function brokenLinks(root) {
  const files = [
    "README.md",
    "CONTRIBUTING.md",
    ...walk(root, "docs", (name) => name.endsWith(".md")),
    ...walk(root, "web/src", (name) => /\.(tsx?|md)$/.test(name)),
  ];
  const cache = new Map();
  const targetAnchors = (target) => {
    if (!cache.has(target)) {
      let found = null;
      try {
        found = anchors(readFileSync(join(root, target), "utf8"));
      } catch {
        // Missing file: every link to it is broken.
      }
      cache.set(target, found);
    }
    return cache.get(target);
  };
  const broken = [];
  const checked = [];
  for (const file of files) {
    const content = readFileSync(join(root, file), "utf8");
    for (const { target, fragment } of fragmentLinks(file, content)) {
      const known = targetAnchors(target);
      const link = `${relative(root, join(root, file))} → ${target}#${fragment}`;
      checked.push(link);
      if (!known?.has(fragment)) broken.push(link);
    }
  }
  return { broken, checked };
}
