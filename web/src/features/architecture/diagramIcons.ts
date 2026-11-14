import {
  Box,
  Database,
  Globe2,
  Layers3,
  LogOut,
  Network,
  Plug,
  Route,
  Server,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
  type LucideIconNode,
} from "lucide-react";
import type { Resource } from "../../lib/types";
import type { DeployMark } from "../deploy/useFloci";

/**
 * Icons and colors of the diagram cards, shared by the canvas and the SVG/PNG
 * export so both draw the same thing.
 */
export interface IconSpec {
  /** Stable name, used as the `<symbol>` id in exports. */
  name: string;
  Icon: LucideIcon;
  color: string;
  background: string;
}

const icons: Record<string, [string, LucideIcon]> = {
  network: ["network", Network],
  compute: ["server", Server],
  security: ["shield-check", ShieldCheck],
  database: ["database", Database],
  storage: ["box", Box],
  loadbalancer: ["workflow", Workflow],
  variable: ["sliders-horizontal", SlidersHorizontal],
  local: ["sigma", Sigma],
  output: ["log-out", LogOut],
  provider: ["plug", Plug],
  other: ["layers-3", Layers3],
};

/** Icon color and background of a resource card, by category. */
const palette: Record<string, { color: string; background: string }> = {
  security: { color: "#789080", background: "#edf4ee" },
  database: { color: "#8e7ba8", background: "#f2edf7" },
  storage: { color: "#6e9a82", background: "#eaf4ef" },
  network: { color: "#6a93b4", background: "#eaf2f8" },
  loadbalancer: { color: "#6a93b4", background: "#eaf2f8" },
  variable: { color: "#6b7f94", background: "#f1f3f6" },
  local: { color: "#6b7f94", background: "#f1f3f6" },
  output: { color: "#5f8f86", background: "#eef6f4" },
  provider: { color: "#94708f", background: "#f6f0f6" },
};
const defaultColors = { color: "#a8784e", background: "#fbf2e9" };

/** VPC and subnet headings use their own icon color, without background. */
export const scopeIconColor = { vpc: "#7c9fb8", subnet: "#81a494" };

export function iconFor(resource: Resource): IconSpec {
  const [name, Icon] =
    resource.type === "aws_internet_gateway"
      ? ["globe-2", Globe2]
      : resource.type.includes("route")
        ? ["route", Route]
        : (icons[resource.category] ?? icons.other);
  return {
    name,
    Icon: Icon as LucideIcon,
    ...(palette[resource.category] ?? defaultColors),
  };
}

/** Floci marks: text and colors, as `.mark-*` in styles.css. */
export const markStyle: Record<
  DeployMark,
  { label: string; color: string; background: string; border: string }
> = {
  create: {
    label: "+ crear",
    color: "#2f7a57",
    background: "#effaf3",
    border: "#9fd3b7",
  },
  update: {
    label: "~ actualizar",
    color: "#8a6420",
    background: "#fdf5e6",
    border: "#ecd3a3",
  },
  replace: {
    label: "± reemplazar",
    color: "#8b4f86",
    background: "#f8eef7",
    border: "#e0bfdc",
  },
  delete: {
    label: "− eliminar",
    color: "#a3473d",
    background: "#fbefed",
    border: "#e8c3be",
  },
  deployed: {
    label: "✓ en Floci",
    color: "#2f7a57",
    background: "#e8f5ee",
    border: "#c4e3d2",
  },
};

/**
 * The shapes of a Lucide icon. lucide-react keeps them on the element its
 * component renders; reading them there avoids a second icon package.
 */
export function iconNodes(Icon: LucideIcon): LucideIconNode[] {
  const render = (
    Icon as unknown as {
      render?: (
        props: object,
        ref: null,
      ) => { props?: { icon?: { node?: LucideIconNode[] } } };
    }
  ).render;
  return render?.({}, null)?.props?.icon?.node ?? [];
}

const attribute = (name: string, value: unknown) =>
  `${name}="${escapeXml(String(value))}"`;

function shape([tag, attributes, children]: LucideIconNode): string {
  // Only drawing elements; nothing that could run or load anything.
  if (!/^(path|circle|rect|line|polyline|polygon|ellipse|g)$/.test(tag))
    return "";
  const attrs = Object.entries(attributes)
    .filter(([name]) => name !== "key" && /^[a-zA-Z-]+$/.test(name))
    .filter(([name]) => !/^on/i.test(name))
    .map(([name, value]) => attribute(name, value))
    .join(" ");
  const inner = (children ?? []).map(shape).join("");
  return `<${tag} ${attrs}>${inner}</${tag}>`;
}

/** A `<symbol>` that draws the icon with `currentColor`, like the canvas. */
export function iconSymbol(name: string, Icon: LucideIcon): string {
  return (
    `<symbol id="icon-${escapeXml(name)}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.65" stroke-linecap="round" ` +
    `stroke-linejoin="round">${iconNodes(Icon).map(shape).join("")}</symbol>`
  );
}

/**
 * Characters XML 1.0 forbids even as references: C0 controls other than
 * tab, line feed and carriage return, and U+FFFE/U+FFFF. (Lone surrogates
 * become U+FFFD when the Blob encodes the file as UTF-8.)
 */
// eslint-disable-next-line no-control-regex -- matching them is the point
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * Escapes text and attribute values for XML: `< > & " '`. A character XML
 * cannot hold (a control character pasted into a value) becomes U+FFFD, so
 * the file still opens.
 */
export function escapeXml(text: string): string {
  return text
    .replace(NOT_XML, "\uFFFD")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
