// Prepara la promoción GitOps: fija el digest publicado de la portada en K3s-Cortex.
//
// No contacta el clúster. El workflow de imágenes hace commit del resultado en
// K3s-Cortex y Argo CD lo aplica. Uso: node scripts/promote.mjs <cortex> <image.txt>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const IMAGE = "ghcr.io/renzoal7/terradock-public";
export const APPLICATION = "clusters/rnz-prod/terradock-application.yaml";
export const OVERLAY = "apps/terradock/overlays/ip/kustomization.yaml";
const CORTEX_REPO = "https://github.com/RenzoAL7/K3s-Cortex.git";
const DIGEST = /^sha256:[a-f0-9]{64}$/;

/** Lee `imagen@sha256:...` y devuelve el digest si la imagen es la esperada. */
export function readDigest(text) {
  const [image, digest = ""] = text.trim().split("@");
  if (image !== IMAGE || !DIGEST.test(digest))
    throw new Error(`Digest no válido para ${IMAGE}: ${text.trim()}`);
  return digest;
}

/** Se niega a tocar Cortex si la aplicación de Argo CD no es la de TerraDock. */
export function checkApplication(text) {
  const field = (name) =>
    text.match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, "m"))?.[1];
  if (
    field("name") !== "terradock-public" ||
    field("repoURL") !== CORTEX_REPO ||
    !field("path")?.startsWith("apps/terradock/overlays/")
  )
    throw new Error(
      "La aplicación de Argo CD no es la esperada; no se modifica nada",
    );
}

/** Sustituye solo el digest de la imagen de la portada en el overlay. */
export function pinOverlay(text, digest) {
  const entry = new RegExp(
    `(- name: ${IMAGE.replaceAll(".", "\\.")}\\n(?:[ \\t]+newName: \\S+\\n)?[ \\t]+digest: )sha256:[a-f0-9]{64}`,
    "g",
  );
  const matches = text.match(entry) ?? [];
  if (matches.length !== 1)
    throw new Error(
      `El overlay debe fijar ${IMAGE} por digest exactamente una vez`,
    );
  return text.replace(entry, `$1${digest}`);
}

export function promote(cortex, imageFile) {
  const digest = readDigest(readFileSync(imageFile, "utf8"));
  checkApplication(readFileSync(join(cortex, APPLICATION), "utf8"));
  const overlay = join(cortex, OVERLAY);
  const before = readFileSync(overlay, "utf8");
  const after = pinOverlay(before, digest);
  if (after !== before) writeFileSync(overlay, after);
  return { overlay: OVERLAY, digest, changed: after !== before };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [cortex, imageFile] = process.argv.slice(2);
  if (!cortex || !imageFile) {
    console.error("Uso: node scripts/promote.mjs <cortex> <image.txt>");
    process.exit(2);
  }
  const result = promote(cortex, imageFile);
  console.log(
    `${result.changed ? "Fijado" : "Sin cambios"} ${result.overlay} → ${result.digest}`,
  );
}
