# Publicación estática en GHCR y K3s

La portada se publica en **https://terradock.renzoaguilar.dev/** y la demo interactiva en **https://terradock.renzoaguilar.dev/demo/**. Cloudflare termina HTTPS y reenvía al balanceador de OCI y a Traefik por el puerto 80. El acceso directo por IP ya no sirve TerraDock.

## Flujo automático

Los workflows siguen el mismo esquema que `RenzoAL7/peru-spend-tracker`:

| Workflow | Cuándo | Qué hace |
| --- | --- | --- |
| `ci.yml` | PR y push a `main` | `make check`, `make test`, `make build`, flujos de navegador de la app local y pruebas de la portada y la demo. |
| `images.yml` | Push a `main` que cambia la portada, o manual | Construye **solo `linux/arm64`** en un runner ARM nativo (`ubuntu-24.04-arm`), prueba el contenedor, publica con caché de capas y procedencia, y promueve el digest a K3s-Cortex. |
| `monitor.yml` | Cada 3 horas, o manual | Revisa portada, demo, `/api` → 404 y `scripts/smoke-public.mjs` contra el dominio. Si algo falla, abre o actualiza un issue; cuando vuelve a funcionar, lo cierra. |

La promoción (`scripts/promote.mjs`) solo cambia el digest de `apps/terradock/overlays/ip/kustomization.yaml` en `RenzoAL7/K3s-Cortex`. Antes de hacerlo, comprueba que la aplicación de Argo CD sea `terradock-public` y renderiza el overlay con `kubectl kustomize` sin contactar el clúster. El commit va directo a `main` de Cortex y Argo CD lo aplica. Para revertir, basta con revertir ese commit en Cortex. Necesita el secreto `CORTEX_REPO_TOKEN`, con permiso de escritura sobre K3s-Cortex.

## Artefacto público

- Imagen: `ghcr.io/renzoal7/terradock-public:sha-<commit-completo>`, fijada por digest en Cortex.
- Plataforma: `linux/arm64`, la VM OCI del clúster. No se publican imágenes amd64.
- Construcción: `Dockerfile.public`, con bases fijadas por digest, Go para compilar el analizador WebAssembly y `npm ci` con el lockfile existente.
- Contenido servido: exclusivamente `web/dist-public/`, más `release.json` con la revisión de origen. Incluye el analizador WebAssembly y sus licencias. No contiene el servidor ni el compilador Go, el editor local, `node_modules`, credenciales ni archivos del checkout.
- Runtime: Nginx sin privilegios, UID 101, puerto 8080, raíz de solo lectura y `/tmp` temporal.
- `images.yml` publica con `GITHUB_TOKEN`, limitado a `contents: read` y `packages: write`.

El contexto Docker usa una lista de archivos permitidos en `Dockerfile.public.dockerignore`. No se incorporan `.git`, herramientas locales, dependencias instaladas, resultados ni configuraciones privadas. La CSP de los documentos permite recursos locales y bloquea conexiones desde JavaScript. Solo el worker del analizador recibe una política que admite WebAssembly y la descarga de su binario desde el mismo origen. Las rutas desconocidas y `/api` responden 404; no hay proxy al servidor local.

El binario se carga al abrir `/demo/`, no en la portada. En el build verificado ocupa aproximadamente 8,5 MB sin comprimir y 2,3 MB transferidos con gzip. Nginx comprime `application/wasm` y los assets con hash usan caché inmutable. La [guía de la demo](browser-demo.md) detalla sus límites y su funcionamiento en memoria.

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

La suite contra un servidor existente ejecuta 18 pruebas y omite solo la de la entrada de desarrollo. Comprueba escritorio/móvil, teclado, enlaces, recursos locales, edición y exportación reales, errores HCL y recuperación del analizador, además de ausencia de errores de consola, cookies, almacenamiento o llamadas a APIs. `scripts/smoke-public.mjs` comprueba ambas páginas, cabeceras, archivos, 404 y la revisión publicada. No prueba el `/healthz` público porque pertenece al balanceador existente.

## Manifiestos y publicación

Los manifiestos están en `RenzoAL7/K3s-Cortex`, rama `main`:

- `apps/terradock/base`: namespace exclusivo `terradock`, Deployment con dos réplicas, Service, cuotas y NetworkPolicy.
- `apps/terradock/overlays/ip`: imagen fijada por digest e Ingress para `terradock.renzoaguilar.dev`, con entrada `web` detrás de Cloudflare.
- `clusters/rnz-prod/terradock-application.yaml`: aplicación Argo CD `terradock-public`, sincronización automática desde `main` y ese overlay.

La política admite entrada de Traefik a 8080 y declara salida denegada. El pod no monta token de Kubernetes, elimina capabilities y usa seccomp RuntimeDefault. Dos réplicas en un único nodo permiten una actualización gradual, pero no proporcionan tolerancia a la caída de la VM.

Para una actualización basta con fusionar en `main`: `images.yml` publica la imagen y fija su digest en Cortex, y Argo CD aplica el cambio. Para hacerlo a mano, se toma el digest del artefacto `digest-public` y se ejecuta `node scripts/promote.mjs <copia-de-cortex> image.txt`. El paquete GHCR debe ser público para permitir la descarga sin credenciales desde K3s. No se aplica el kustomization completo del clúster para registrar esta aplicación: el bootstrap usa solo `terradock-application.yaml`.

Verificación externa, desde la raíz de TerraDock:

```sh
PUBLIC_BASE_URL=https://terradock.renzoaguilar.dev EXPECTED_REVISION=<commit-completo> node scripts/smoke-public.mjs
PUBLIC_BASE_URL=https://terradock.renzoaguilar.dev npm --prefix web run test:public
```

El digest exacto desplegado vive en el overlay; `https://terradock.renzoaguilar.dev/release.json` identifica el commit de la portada. Las evidencias de la publicación inicial se guardan en `docs/deployment/`.

## Reversión

Para volver a una imagen anterior, restaurar su digest en el overlay de Cortex y publicar el cambio. No usar `kubectl rollout undo` como solución persistente: Argo CD restauraría el estado de Git.

Para retirar esta primera publicación, eliminar **solo** la aplicación `terradock-public` de Argo CD con eliminación en cascada; su finalizer retira los recursos de TerraDock. No eliminar Traefik, el balanceador, la aplicación `gpath-prod` ni el namespace `gpath`. Después retirar la referencia de TerraDock de `clusters/rnz-prod/kustomization.yaml` y sus manifiestos cuando corresponda.

## Dependencias

La auditoría del lockfile el 18 de octubre de 2026 informó tres paquetes con avisos: `brace-expansion` (ESLint), `source-map-js` (Vite/PostCSS) y `dompurify` (Monaco del editor local). Los dos primeros son herramientas de construcción y el tercero pertenece a la entrada local; ninguno forma parte del bundle de la portada ni del runtime Nginx. Esta entrega conserva el lockfile y no afirma que el repositorio completo carezca de avisos. Las bases del contenedor deben actualizarse periódicamente mediante sus digests.
