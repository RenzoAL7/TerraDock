import {
  getSmoothStepPath,
  Position,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { LucideIcon } from "lucide-react";
import type { DeployMark } from "../deploy/useFloci";
import {
  escapeXml as esc,
  iconFor,
  iconSymbol,
  markStyle,
  scopeIconColor,
} from "./diagramIcons";
import {
  cardDetail,
  repeatMark,
  scopeMeta,
  shortType,
  type ResourceNodeData,
} from "./graph";

/** What the band at the top of an export says about the view and its scope. */
export interface ExportCaption {
  project: string;
  /** Already formatted: the serializer never reads the clock. */
  date: string;
  resources: number;
  /** Text of the active search; its non-matching nodes are drawn faded. */
  filter?: string;
  /** Files whose unsaved drafts the diagram shows. */
  drafts?: number;
}

export interface DiagramToSvgInput {
  /** The model nodes (getNodes()), not the DOM: large diagrams only render what is visible. */
  nodes: Node<ResourceNodeData>[];
  edges: Edge[];
  caption: ExportCaption;
  /** `@font-face` rules with data: URLs, so the file draws the same anywhere. */
  fontsCss?: string;
}

export interface DiagramSvg {
  svg: string;
  width: number;
  height: number;
}

interface Box {
  node: Node<ResourceNodeData>;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Icons = Map<string, LucideIcon>;

const MARGIN = 40;
const BAND = 78;
const SANS = "'Manrope Variable', Manrope, 'Segoe UI', Arial, sans-serif";
const MONO = "'IBM Plex Mono', Menlo, Consolas, monospace";
const n = (value: number) => String(Math.round(value * 10) / 10);
const size = (value: unknown, fallback: number) => {
  const v = Number(value);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
/** Rough width of a text in the card fonts, to place marks after it. */
const textWidth = (text: string, px: number) => text.length * px * 0.58;

/** Absolute boxes: positions are relative to the parent chain. */
function boxes(nodes: Node<ResourceNodeData>[]): Box[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const absolute = new Map<string, { x: number; y: number }>();
  const at = (
    node: Node<ResourceNodeData>,
    seen = 0,
  ): { x: number; y: number } => {
    const known = absolute.get(node.id);
    if (known) return known;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // A broken or cyclic parent chain is drawn from the root instead.
    const base = parent && seen < 64 ? at(parent, seen + 1) : { x: 0, y: 0 };
    const point = { x: base.x + node.position.x, y: base.y + node.position.y };
    absolute.set(node.id, point);
    return point;
  };
  return nodes.map((node) => ({
    node,
    ...at(node),
    width: size(node.style?.width ?? node.width ?? node.measured?.width, 214),
    height: size(
      node.style?.height ?? node.height ?? node.measured?.height,
      96,
    ),
  }));
}

function text(x: number, y: number, content: string, attrs: string): string {
  return `<text x="${n(x)}" y="${n(y)}" ${attrs}>${esc(content)}</text>`;
}

function mark(kind: DeployMark | undefined, right: number, top: number) {
  if (!kind || !markStyle[kind]) return "";
  const style = markStyle[kind];
  const width = textWidth(style.label, 8) + 10;
  const x = right - width;
  return (
    `<g data-mark="${esc(kind)}">` +
    `<rect x="${n(x)}" y="${n(top)}" width="${n(width)}" height="13" rx="4" fill="${style.background}" stroke="${style.border}"${kind === "create" ? ' stroke-dasharray="3 2"' : ""}/>` +
    text(
      x + width / 2,
      top + 9.5,
      style.label,
      `text-anchor="middle" font-family="${MONO}" font-size="8" font-weight="600" fill="${style.color}"`,
    ) +
    `</g>`
  );
}

function repeat(resource: ResourceNodeData["resource"], x: number, y: number) {
  const r = repeatMark(resource);
  if (!r) return "";
  const width = Math.min(90, textWidth(r.text, 9) + 10);
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="14" rx="4" fill="#eaf2f8" stroke="#d5e4ef"/>` +
    text(
      x + 5,
      y + 10,
      r.text,
      `font-family="${MONO}" font-size="9" font-weight="600" fill="#4d7495"`,
    )
  );
}

function card({ node, x, y, width, height }: Box, icons: Icons): string {
  const r = node.data.resource;
  const icon = iconFor(r);
  icons.set(icon.name, icon.Icon);
  const kind = shortType(r.type);
  const muted = node.data.muted ? ' opacity="0.3"' : "";
  const stroke = node.selected
    ? 'stroke="#4c96c6" stroke-width="1.5"'
    : 'stroke="#cfdae4" stroke-width="1"';
  return (
    `<g data-id="${esc(node.id)}" data-kind="resource"${muted}>` +
    `<svg x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" overflow="hidden">` +
    `<rect x="0.5" y="0.5" width="${n(width - 1)}" height="${n(height - 1)}" rx="7" fill="#ffffff" ${stroke}/>` +
    `<rect x="14" y="12" width="23" height="23" rx="4" fill="${icon.background}"/>` +
    `<use href="#icon-${esc(icon.name)}" x="15.5" y="13.5" width="20" height="20" color="${icon.color}"/>` +
    text(45, 27, kind, `font-family="${SANS}" font-size="9" fill="#8b9aab"`) +
    repeat(r, 45 + textWidth(kind, 9) + 8, 16.5) +
    (node.data.mark
      ? mark(node.data.mark as DeployMark, width - 14, 17)
      : `<circle cx="${n(width - 16)}" cy="23.5" r="2" fill="#a9b8c5"/>`) +
    // The text area clips long names and values like the card does.
    `<svg x="14" y="0" width="${n(Math.max(0, width - 28))}" height="${n(height)}" overflow="hidden">` +
    text(
      0,
      56,
      r.label || r.name,
      `font-family="${SANS}" font-size="12" font-weight="650" fill="#32465d"`,
    ) +
    text(
      0,
      74,
      cardDetail(r),
      `font-family="${MONO}" font-size="9" fill="#8a98a7"`,
    ) +
    `</svg></svg></g>`
  );
}

function scope({ node, x, y, width, height }: Box, icons: Icons): string {
  const r = node.data.resource;
  const vpc = r.type === "aws_vpc";
  const icon = iconFor(r);
  icons.set(icon.name, icon.Icon);
  const pad = vpc ? { x: 18, y: 16 } : { x: 14, y: 13 };
  const [cidr, detail] = scopeMeta(r, node.data.childCount);
  const type = shortType(r.type);
  const typeWidth = textWidth(type, 8) + 10;
  const muted = node.data.muted ? ' opacity="0.3"' : "";
  const stroke = node.selected
    ? `stroke="#5691b8" stroke-width="1.5"`
    : `stroke="${vpc ? "#8aafc8" : "#abc4b9"}" stroke-width="1" stroke-dasharray="4 3"`;
  const metaX = vpc ? pad.x + 26 : pad.x;
  return (
    `<g data-id="${esc(node.id)}" data-kind="scope"${muted}>` +
    `<svg x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" overflow="hidden">` +
    `<rect x="0.5" y="0.5" width="${n(width - 1)}" height="${n(height - 1)}" rx="${vpc ? 9 : 6}" fill="${vpc ? "#e2eef7" : "#edf4f1"}" fill-opacity="${vpc ? "0.2" : "0.43"}" ${stroke}/>` +
    `<use href="#icon-${esc(icon.name)}" x="${pad.x}" y="${pad.y}" width="17" height="17" color="${vpc ? scopeIconColor.vpc : scopeIconColor.subnet}"/>` +
    `<rect x="${n(width - pad.x - typeWidth)}" y="${pad.y + 1}" width="${n(typeWidth)}" height="14" rx="3" fill="${vpc ? "#e4edf5" : "#e6efea"}"/>` +
    text(
      width - pad.x - typeWidth / 2,
      pad.y + 11,
      type,
      `text-anchor="middle" font-family="${MONO}" font-size="8" fill="${vpc ? "#7692aa" : "#7a988b"}"`,
    ) +
    mark(
      node.data.mark as DeployMark | undefined,
      width - pad.x - typeWidth - 8,
      pad.y + 1,
    ) +
    `<svg x="${pad.x + 26}" y="0" width="${n(Math.max(0, width - pad.x * 2 - 26 - typeWidth - 8))}" height="${n(height)}" overflow="hidden">` +
    text(
      0,
      pad.y + 13,
      r.label || r.name,
      `font-family="${SANS}" font-size="${vpc ? 12 : 10}" font-weight="700" fill="#14253b"`,
    ) +
    `</svg>` +
    text(
      metaX,
      pad.y + 32,
      cidr,
      `font-family="${MONO}" font-size="8" fill="${vpc ? "#8ca1b2" : "#8aa697"}"`,
    ) +
    text(
      width - pad.x,
      pad.y + 32,
      detail,
      `text-anchor="end" font-family="${MONO}" font-size="8" fill="${vpc ? "#8ca1b2" : "#8aa697"}"`,
    ) +
    (node.data.childCount
      ? ""
      : text(
          width / 2,
          pad.y + 84,
          "Sin recursos asociados",
          `text-anchor="middle" font-family="${SANS}" font-size="9" fill="#98aaa4"`,
        )) +
    `</svg></g>`
  );
}

function edgePath(edge: Edge, byId: Map<string, Box>): string {
  const source = byId.get(edge.source),
    target = byId.get(edge.target);
  if (!source || !target) return "";
  const [d] = getSmoothStepPath({
    sourceX: source.x + source.width / 2,
    sourceY: source.y + source.height,
    sourcePosition: Position.Bottom,
    targetX: target.x + target.width / 2,
    targetY: target.y,
    targetPosition: Position.Top,
  });
  const style = edge.style ?? {};
  const stroke = String(style.stroke ?? "#a0b4c7");
  const width = size(style.strokeWidth, 1.2);
  const opacity = Number(style.opacity ?? 0.65);
  return (
    `<path data-edge="${esc(edge.id)}" d="${esc(d)}" fill="none" ` +
    `stroke="${esc(stroke)}" stroke-width="${n(width)}" ` +
    `stroke-opacity="${n(Number.isFinite(opacity) ? opacity : 0.65)}"/>`
  );
}

function band(caption: ExportCaption, x: number, y: number, width: number) {
  const scope = [
    "Vista de arquitectura",
    `${caption.resources} ${caption.resources === 1 ? "recurso" : "recursos"}`,
    caption.date,
  ].join(" · ");
  const notes: string[] = [];
  if (caption.filter)
    notes.push(
      `Filtro activo: «${caption.filter}» (los recursos que no coinciden aparecen atenuados)`,
    );
  if (caption.drafts)
    notes.push(
      caption.drafts === 1
        ? "Incluye cambios sin guardar en 1 archivo"
        : `Incluye cambios sin guardar en ${caption.drafts} archivos`,
    );
  if (!notes.length)
    notes.push("Configuración declarada, no estado desplegado");
  return (
    `<g data-band="caption">` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${BAND - 14}" rx="8" fill="#ffffff" stroke="#dce4ec"/>` +
    text(
      x + 16,
      y + 22,
      caption.project,
      `font-family="${SANS}" font-size="14" font-weight="700" fill="#14253b"`,
    ) +
    text(
      x + width - 16,
      y + 22,
      "TerraDock",
      `text-anchor="end" font-family="${SANS}" font-size="10" font-weight="700" fill="#307eb3"`,
    ) +
    text(
      x + 16,
      y + 39,
      scope,
      `font-family="${SANS}" font-size="10" fill="#6c7e91"`,
    ) +
    text(
      x + 16,
      y + 54,
      notes.join(" · "),
      `font-family="${SANS}" font-size="10" fill="${caption.filter || caption.drafts ? "#8a6420" : "#6c7e91"}"`,
    ) +
    `</g>`
  );
}

/**
 * Serializes the diagram model to a standalone SVG. It draws what the canvas
 * shows (cards, containers, references, Floci marks, faded search results)
 * from the model, so nodes off screen are included too. Every text and
 * attribute value is escaped; no script or event attribute is ever written.
 */
export function diagramToSvg({
  nodes,
  edges,
  caption,
  fontsCss,
}: DiagramToSvgInput): DiagramSvg {
  const all = boxes(nodes);
  const byId = new Map(all.map((box) => [box.node.id, box]));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const box of all) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!all.length) minX = minY = maxX = maxY = 0;
  const width = Math.max(640, maxX - minX + MARGIN * 2);
  const left = minX - MARGIN;
  const top = minY - MARGIN - BAND;
  const height = maxY - top + MARGIN;
  const icons: Icons = new Map();
  // Containers first, then references, then cards on top, like the canvas.
  const scopes = all
    .filter((b) => b.node.type === "scope")
    .map((b) => scope(b, icons));
  const paths = edges.map((edge) => edgePath(edge, byId)).filter(Boolean);
  const cards = all
    .filter((b) => b.node.type !== "scope")
    .map((b) => card(b, icons));
  const symbols = [...icons]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, Icon]) => iconSymbol(name, Icon))
    .join("");
  const style = fontsCss ? `<style>${esc(fontsCss)}</style>` : "";
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="${n(left)} ${n(top)} ${n(width)} ${n(height)}" font-family="${SANS}">` +
    `<title>${esc(`${caption.project} · Vista de arquitectura`)}</title>` +
    `<defs>${style}${symbols}</defs>` +
    `<rect x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(height)}" fill="#f7f9fb"/>` +
    band(caption, left + MARGIN / 2, top + MARGIN / 2, width - MARGIN) +
    `<g data-layer="scopes">${scopes.join("")}</g>` +
    `<g data-layer="edges">${paths.join("")}</g>` +
    `<g data-layer="cards">${cards.join("")}</g>` +
    `</svg>\n`;
  return { svg, width, height };
}
