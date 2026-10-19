# Publicación estática en GHCR y K3s

La portada se publica en **http://193.122.221.201/** mediante el balanceador existente de OCI y Traefik. Este acceso inicial usa HTTP: todavía no hay dominio ni certificado propio de TerraDock. La ruta de `gpath.tech` y el chequeo `/healthz` del balanceador conservan sus recursos existentes.

## Artefacto público

- Código: rama `codex/landing-publica` de `RenzoAL7/TerraDock`.
- Imagen: `ghcr.io/renzoal7/terradock-public:sha-<commit-completo>`.
- Plataformas: `linux/arm64` (VM OCI actual) y `linux/amd64`.
- Construcción: `Dockerfile.public`, bases fijadas por digest y `npm ci` con el lockfile existente.
- Contenido servido: exclusivamente `web/dist-public/`, más `release.json` con la revisión de origen. El runtime no contiene Go, el editor local, `node_modules`, credenciales ni archivos del checkout.
- Runtime: Nginx sin privilegios, UID 101, puerto 8080, raíz de solo lectura y `/tmp` temporal.
- `.github/workflows/public-site.yml` valida la portada y el contenedor antes de publicar con `GITHUB_TOKEN`, limitado a `contents: read` y `packages: write`. No necesita un PAT persistente en OCI.

El contexto Docker usa una lista de archivos permitidos en `Dockerfile.public.dockerignore`. No se incorporan `.git`, herramientas locales, dependencias instaladas, resultados ni configuraciones privadas. La CSP permite recursos locales y bloquea conexiones desde JavaScript. Las rutas desconocidas y `/api` responden 404; no hay proxy al servidor local.

## Comprobar la imagen localmente

Desde la raíz del checkout:

```sh
docker build -f Dockerfile.public --build-arg VCS_REF="$(git rev-parse HEAD)" -t terradock-public:check .
docker run -d --name terradock-public-check --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL \
  --security-opt no-new-privileges -p 127.0.0.1:8088:8080 terradock-public:check
EXPECTED_REVISION="$(git rev-parse HEAD)" node scripts/smoke-public.mjs
PUBLIC_BASE_URL=http://127.0.0.1:8088 npm --prefix web run test:public
docker rm -f terradock-public-check
```

La suite contra un servidor existente ejecuta nueve pruebas y omite solo la de la entrada de desarrollo. Comprueba escritorio/móvil, teclado, enlaces, recursos locales y ausencia de errores de consola, cookies, almacenamiento o llamadas a APIs. `scripts/smoke-public.mjs` comprueba cabeceras, archivos, 404 y la revisión publicada. No prueba el `/healthz` público porque pertenece al balanceador existente.

## Manifiestos y publicación

Los manifiestos están en `RenzoAL7/K3s-Cortex`, rama `codex/terradock-publica`:

- `apps/terradock/base`: namespace exclusivo `terradock`, Deployment con dos réplicas, Service, cuotas y NetworkPolicy.
- `apps/terradock/overlays/ip`: imagen fijada por digest e Ingress `/` sin host, con prioridad 1. Las rutas específicas de GPath tienen precedencia.
- `clusters/rnz-prod/terradock-application.yaml`: aplicación Argo CD `terradock-public`, sincronización automática desde esa rama y ese overlay.

La política admite entrada de Traefik a 8080 y declara salida denegada. El pod no monta token de Kubernetes, elimina capabilities y usa seccomp RuntimeDefault. Dos réplicas en un único nodo permiten una actualización gradual, pero no proporcionan tolerancia a la caída de la VM.

Para una actualización: publicar el código en su rama, esperar el workflow, tomar el digest de `public-image-digest`, actualizar el overlay de Cortex y publicar esa rama. Argo CD aplica el cambio. El paquete GHCR debe ser público para permitir la descarga sin credenciales desde K3s. No se aplica el kustomization completo del clúster para registrar esta aplicación: el bootstrap usa solo `terradock-application.yaml`.

Verificación externa, desde la raíz de TerraDock:

```sh
PUBLIC_BASE_URL=http://193.122.221.201 EXPECTED_REVISION=<commit-completo> node scripts/smoke-public.mjs
PUBLIC_BASE_URL=http://193.122.221.201 npm --prefix web run test:public
```

El digest exacto desplegado vive en el overlay; `http://193.122.221.201/release.json` identifica el commit de la portada. Las evidencias de la publicación inicial se guardan en `docs/deployment/`.

## Reversión

Para volver a una imagen anterior, restaurar su digest en el overlay de Cortex y publicar el cambio. No usar `kubectl rollout undo` como solución persistente: Argo CD restauraría el estado de Git.

Para retirar esta primera publicación, eliminar **solo** la aplicación `terradock-public` de Argo CD con eliminación en cascada; su finalizer retira los recursos de TerraDock. No eliminar Traefik, el balanceador, la aplicación `gpath-prod` ni el namespace `gpath`. Después retirar la referencia de TerraDock de `clusters/rnz-prod/kustomization.yaml` y sus manifiestos cuando corresponda.

## Dependencias

La auditoría del lockfile el 18 de octubre de 2026 informó tres paquetes con avisos: `brace-expansion` (ESLint), `source-map-js` (Vite/PostCSS) y `dompurify` (Monaco del editor local). Los dos primeros son herramientas de construcción y el tercero pertenece a la entrada local; ninguno forma parte del bundle de la portada ni del runtime Nginx. Esta entrega conserva el lockfile y no afirma que el repositorio completo carezca de avisos. Las bases del contenedor deben actualizarse periódicamente mediante sus digests.
