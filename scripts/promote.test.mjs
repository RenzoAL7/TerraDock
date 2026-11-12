import assert from "node:assert/strict";
import { test } from "node:test";
import { checkApplication, pinOverlay, readDigest } from "./promote.mjs";

const old = `sha256:${"a".repeat(64)}`;
const next = `sha256:${"b".repeat(64)}`;
const overlay = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: terradock
resources:
  - ../../base
  - ingress.yaml
images:
  - name: ghcr.io/renzoal7/terradock-public
    newName: ghcr.io/renzoal7/terradock-public
    digest: ${old}
`;
const application = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: terradock-public
spec:
  source:
    repoURL: https://github.com/RenzoAL7/K3s-Cortex.git
    targetRevision: main
    path: apps/terradock/overlays/ip
`;

test("fija solo el digest de la portada", () => {
  const pinned = pinOverlay(overlay, next);
  assert.equal(pinned, overlay.replace(old, next));
  assert.equal(pinOverlay(pinned, next), pinned);
});

test("rechaza overlays ambiguos o sin la imagen", () => {
  assert.throws(() => pinOverlay("images: []\n", next));
  assert.throws(() => pinOverlay(overlay + overlay, next));
});

test("valida la imagen y el digest publicados", () => {
  assert.equal(readDigest(`ghcr.io/renzoal7/terradock-public@${next}\n`), next);
  assert.throws(() => readDigest(`ghcr.io/renzoal7/otra@${next}`));
  assert.throws(() => readDigest("ghcr.io/renzoal7/terradock-public@sha256:x"));
});

test("solo acepta la aplicación de Argo CD de TerraDock", () => {
  checkApplication(application);
  assert.throws(() =>
    checkApplication(application.replace("terradock-public", "gpath-prod")),
  );
  assert.throws(() =>
    checkApplication(application.replace("apps/terradock/", "apps/gpath/")),
  );
});
