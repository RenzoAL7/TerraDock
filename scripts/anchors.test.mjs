import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { anchors, brokenLinks, fragmentLinks, slug } from "./anchors.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("genera slugs como GitHub, con acentos y signos", () => {
  assert.equal(slug("¿Qué necesito?"), "qué-necesito");
  assert.equal(
    slug("Opción 2: descargarlo para usar tus archivos"),
    "opción-2-descargarlo-para-usar-tus-archivos",
  );
  assert.equal(
    slug("Desplegar en local con Floci (opcional)"),
    "desplegar-en-local-con-floci-opcional",
  );
  assert.equal(slug("Usar `--root` y [docs](x.md)"), "usar---root-y-docs");
});

test("numera encabezados repetidos e ignora bloques de código", () => {
  const found = anchors("# A\n## A\n```sh\n# no es un título\n```\n## B\n");
  assert.deepEqual([...found], ["a", "a-1", "b"]);
});

test("encuentra enlaces del repositorio, relativos y del mismo archivo", () => {
  const links = fragmentLinks(
    "docs/limitations.md",
    "[a](../README.md#empezar) [b](roadmap.md#x) [c](#y) " +
      "https://github.com/RenzoAL7/TerraDock#readme " +
      "https://github.com/RenzoAL7/TerraDock#para-desarrolladores " +
      "https://github.com/RenzoAL7/TerraDock/blob/main/docs/roadmap.md#z",
  );
  assert.deepEqual(
    links.map(({ target, fragment }) => `${target}#${fragment}`).sort(),
    [
      "README.md#empezar",
      "README.md#para-desarrolladores",
      "docs/limitations.md#y",
      "docs/roadmap.md#x",
      "docs/roadmap.md#z",
    ],
  );
});

test("detecta un ancla rota", () => {
  const links = fragmentLinks(
    "CONTRIBUTING.md",
    "[x](README.md#probar-la-demo)",
  );
  const readme = anchors("# TerraDock\n## Empezar\n");
  assert.equal(readme.has(links[0].fragment), false);
});

test("todas las anclas enlazadas existen en el repositorio", () => {
  const { broken, checked } = brokenLinks(root);
  assert.ok(checked.length > 0, "no se encontró ningún enlace con ancla");
  assert.deepEqual(broken, []);
});
