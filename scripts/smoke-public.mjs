import assert from "node:assert/strict";

const base = new URL(process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8088/");
const get = (path) =>
  fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
const home = await get("./");
assert.equal(home.status, 200, "public page");
assert.match(
  home.headers.get("content-security-policy") || "",
  /connect-src 'none'/,
);
assert.equal(home.headers.get("x-content-type-options"), "nosniff");
const html = await home.text();
assert.match(html, /TerraDock/);
const assets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(
  (match) => match[1],
);
assert.ok(assets.length >= 3, "compiled JS, CSS and favicon");
for (const asset of assets) {
  assert.equal(new URL(asset, base).origin, base.origin, "local asset");
  const response = await get(asset);
  assert.equal(response.status, 200, asset);
  assert.match(response.headers.get("cache-control") || "", /immutable/);
}
for (const path of [
  "api",
  "api/session",
  "api/project",
  "src/main.tsx",
  ".git/config",
  "nonexistent-page",
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
    assets: assets.length,
    checks: "passed",
  }),
);
