import manropeUrl from "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url";
import plexRegularUrl from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url";
import plexMediumUrl from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url";
import { fileSlug } from "../../lib/download";
import { diagramToSvg, type DiagramToSvgInput } from "./exportDiagram";

export type ExportFormat = "svg" | "png";

/** Builds the file for "Exportar": the SVG with fonts inside, or its PNG. */
export async function exportDiagram(
  format: ExportFormat,
  input: Omit<DiagramToSvgInput, "fontsCss">,
): Promise<{ blob: Blob; name: string }> {
  const { svg, width, height } = diagramToSvg({
    ...input,
    fontsCss: await embeddedFontsCss(),
  });
  const name = `${fileSlug(input.caption.project)}-arquitectura.${format}`;
  if (format === "svg")
    return {
      blob: new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      name,
    };
  return { blob: await svgToPng(svg, width, height), name };
}

/** Chromium refuses larger canvases; this keeps a PNG well under that. */
export const MAX_PIXELS = 16_777_216;
const MAX_SIDE = 16_384;

/**
 * The scale a PNG is drawn at: `preferred` (2× for sharp text) unless the
 * image would pass about 16.7 million pixels or 16384 px on a side.
 */
export function pngScale(width: number, height: number, preferred = 2) {
  const byArea = Math.sqrt(MAX_PIXELS / Math.max(1, width * height));
  const bySide = MAX_SIDE / Math.max(1, width, height);
  return Math.min(preferred, byArea, bySide);
}

async function dataUrl(url: string): Promise<string> {
  // Small files may already be inlined by the build.
  if (url.startsWith("data:")) return url;
  // Same-origin asset: allowed by connect-src 'self'.
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo leer la fuente ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:font/woff2;base64,${btoa(binary)}`;
}

let fonts: Promise<string> | null = null;
/**
 * `@font-face` rules for Manrope and IBM Plex Mono with the fonts inlined.
 * An SVG drawn as an image cannot load anything, so they travel inside it.
 */
export function embeddedFontsCss(): Promise<string> {
  fonts ??= Promise.all([
    dataUrl(manropeUrl),
    dataUrl(plexRegularUrl),
    dataUrl(plexMediumUrl),
  ])
    .then(
      ([manrope, regular, medium]) =>
        `@font-face{font-family:'Manrope Variable';font-weight:200 800;src:url(${manrope}) format('woff2');}` +
        `@font-face{font-family:'IBM Plex Mono';font-weight:400;src:url(${regular}) format('woff2');}` +
        `@font-face{font-family:'IBM Plex Mono';font-weight:500 700;src:url(${medium}) format('woff2');}`,
    )
    .catch((error: unknown) => {
      fonts = null;
      throw error;
    });
  return fonts;
}

/**
 * SVG → Blob URL → decoded image → canvas → PNG. Everything stays in the
 * page: the local CSP allows `blob:` images, and the SVG has no
 * foreignObject, so the canvas is not tainted.
 */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
): Promise<Blob> {
  const scale = pngScale(width, height);
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    image.width = width;
    image.height = height;
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("El navegador no permite dibujar el PNG.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("El navegador no pudo generar el PNG.")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
