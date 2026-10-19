# Validación de la portada pública

Revisión local del 18 de octubre de 2026 (America/Lima), en la rama `codex/landing-publica`, basada en `origin/main` (`ff839ce`). El checkout estaba limpio antes de comenzar. Remoto verificado: `https://github.com/RenzoAL7/TerraDock.git`.

## Resultado

| Comprobación | Resultado |
| --- | --- |
| `make check` | Formato Go/Prettier, `go vet`, ESLint y TypeScript correctos. |
| `make test` | Pruebas Go con `-race` correctas; 22 pruebas de frontend correctas. |
| `make build` | Aplicación local y binario Go compilados. |
| `make e2e` | 9 de 9 escenarios de la aplicación local correctos. |
| `npm run test:public` desde `web/` | Build público y 10 de 10 pruebas correctas; equivalente a `make public-e2e`. |
| Entrada de desarrollo | `npm run dev:public` carga la página y sus fuentes sin errores; cubierto por una regresión. |
| Entrada de producción | `web/dist-public/index.html` y assets se sirven sin Go ni llamadas a la API. |
| Rutas privadas / inexistentes | `/api/session`, `/api/project`, `/api/directories`, `/src/main.tsx` y `/ruta-inexistente` responden 404 en el preview público. |
| Navegación | Anclas reales, enlaces a documentación existente y licencia local accesible; acceso deshabilitado como Próximamente. |
| Teclado | Salto al contenido, foco visible, enlace al ejemplo y desplazamiento horizontal interno por flechas. |
| Responsive | Capturas en 320, 390, 601, 768, 1024 y 1440 px, sin desbordamiento horizontal de la página. |
| Recursos y almacenamiento | Sin solicitudes externas en la portada, sin cookies ni escritura en localStorage/sessionStorage. |
| Dependencias y app local | Sin cambios en el lockfile, dependencias, backend, editor, canvas ni entradas de la aplicación local. |
| `git diff --check` | Correcto. |

Entorno usado: macOS ARM64, Node.js 26.5.0, npm 12.0.2, Go 1.27.1 y Chromium de Playwright. Se reutilizaron las dependencias instaladas. En este entorno se usaron `GOCACHE="$PWD/.tools/go-cache"` y `GOMODCACHE="$PWD/.tools/go-mod-cache"` para los comandos Make de Go. El sandbox requirió permiso para abrir los puertos locales de las pruebas; las ejecuciones finales autorizadas pasaron.

El build público contiene HTML, un bundle JavaScript, CSS, favicon, fuentes y sus licencias; aproximadamente 319 kB en disco. No contiene Monaco, workers de editor, archivos de proyectos ni el cliente de la API local. El build de la aplicación local conserva la advertencia existente de Vite sobre el tamaño de Monaco; no afecta al build público.

## Capturas revisadas

- [Portada de escritorio completa, 1440 px](screenshots/public/desktop.png).
- [Primer viewport de escritorio](screenshots/public/hero.png).
- [Portada móvil completa, 390 px](screenshots/public/mobile.png).
- [Arquitectura visible al desplazar el ejemplo en móvil](screenshots/public/mobile-architecture.png).

Se comprobó visualmente la jerarquía del texto, las secciones, el estado del acceso, la distinción entre funciones actuales/futuras y el contenido de ambos paneles. A 1024 px el ejemplo cabe completo; en móvil conserva el desplazamiento interno y su indicación. Las capturas son del build real servido por HTTP, no del mockup recibido.

## Límites de esta evidencia

La revisión de navegador se realizó en Chromium; no certifica otros motores ni constituye una auditoría exhaustiva de accesibilidad. Los destinos externos se contrastaron con el repositorio remoto y sus archivos; la prueba automática no navega a GitHub. La comprobación de rutas 404 corresponde al servidor de preview: el servidor del despliegue deberá conservar ese comportamiento.

No se accedió a la VM, OCI, k3s o GPath. No se generaron manifiestos, publicaron imágenes, configuraron dominios ni realizaron push, PR o merge. El resultado es una portada local revisable; no acredita una publicación por HTTPS.
