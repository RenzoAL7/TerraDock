import assert from "node:assert/strict";

const base = new URL(process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8088/");
const get = (path) =>
  fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
const assets = new Set();
for (const pathname of ["./", "demo/"]) {
  const pageURL = new URL(pathname, base);
  const page = await get(pageURL);
  assert.equal(page.status, 200, pathname);
  assert.match(
    page.headers.get("content-security-policy") || "",
    /connect-src 'none'/,
  );
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  const html = await page.text();
  assert.match(html, /TerraDock/);
  const references = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)];
  assert.ok(references.length >= 3, "compiled JS, CSS and favicon");
  for (const [, asset] of references) {
    const url = new URL(asset, pageURL);
    assert.equal(url.origin, base.origin, "local asset");
    const response = await get(url);
    assert.equal(response.status, 200, url.href);
    assert.match(response.headers.get("cache-control") || "", /immutable/);
    assets.add(url.href);
  }
}
for (const path of [
  "api",
  "api/session",
  "api/project",
  "src/main.tsx",
  ".git/config",
  "nonexistent-page",
  "demo/api/session",
]) {
  assert.equal((await get(path)).status, 404, path);
}
const release = await get("release.json");
assert.equal(release.status, 200);
const info = await release.json();
assert.equal(info.application, "terradock-public");
if (process.env.EXPECTED_REVISION)
  assert.equal(info.revision, process.env.EXPECTED_REVISION);
console.log(
  JSON.stringify({
    base: base.href,
    ...info,
    assets: assets.size,
    checks: "passed",
  }),
);
