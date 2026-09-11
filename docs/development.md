# Desarrollo y pruebas

## Entorno

Usa Go 1.25 o superior y Node.js 24. `go.mod`, `go.sum` y `web/package-lock.json` fijan las dependencias del proyecto. La demo no necesita Terraform ni una cuenta AWS. La primera instalación requiere acceso a los registros de dependencias; el uso del build local procesa los archivos en el equipo.

```sh
make install
```

Las carpetas de dependencias, herramientas locales y compilaciones están excluidas de Git. No copies `node_modules`, `.terraform` ni estados de infraestructura al repositorio.

## Trabajar en la interfaz y API

```sh
# Primera terminal, desde la raíz
make dev-api
```

```sh
# Segunda terminal, desde la raíz
make dev-web
```

Abre `http://127.0.0.1:5173`. La API escucha por defecto en el puerto 7331. `make dev-api` añade `--dev-origin http://127.0.0.1:5173` para autorizar las peticiones del proxy de Vite; el build servido por Go usa un solo origen y no necesita esa opción. Si cambias `PORT`, ajusta también el destino del proxy en `web/vite.config.ts`. Si cambias la dirección de Vite, pasa ese origen exacto mediante `DEV_ORIGIN`. Para habilitar otra raíz de proyectos:

```sh
make dev-api ROOT=/ruta/a/proyectos
```

## Compilar y servir

```sh
make build
make run
```

`make build` genera `web/dist` y `bin/terradock`. No empaqueta un instalador ni publica una versión. `make run` sirve esos assets y acepta `ROOT`, `PORT` y `ASSETS`:

```sh
make run ROOT=/ruta/a/proyectos PORT=7441
```

Ejecuta el binario desde la raíz del repositorio o pasa `--assets` con la ubicación correcta del frontend. Si el puerto está ocupado, cierra el otro proceso o elige otro puerto.

## Distribución de pruebas

| Nivel | Ubicación | Qué debe comprobar |
| --- | --- | --- |
| Parser y escritura | `internal/**/*_test.go` | Interpretación, referencias, cambios de literales y conservación de contenido |
| API y archivos | `internal/**/*_test.go` | Validación de entradas, límites de acceso y conflictos de revisión |
| Lógica de interfaz | `web/src/**/*.test.*` | Derivación de vistas y comportamiento de estado |
| Navegador | `web/tests/` | Interacción real con demo, editor, inspector y carpetas |

La estrategia es probar contratos observables. Los casos de escritura usan directorios temporales y no deben modificar archivos personales ni los ejemplos versionados. Las pruebas no realizan despliegues.

```sh
make check
make test
make build
make e2e-install
make e2e
git diff --check
```

- `make check`: formato Go, `go vet`, formato frontend, ESLint y TypeScript.
- `make test`: pruebas Go con detector de carreras y pruebas unitarias del frontend.
- `make e2e`: Playwright; su configuración levanta los servicios necesarios y define puertos propios para las pruebas.

Las pruebas de navegador compilan el frontend y el ejecutable, y ejecutan la aplicación desde un único servidor Go en `127.0.0.1:7332`. Así verifican los assets de producción y el protocolo de la API que usa el build local. Ese puerto debe estar libre antes de ejecutar la suite.

El runner crea una raíz temporal exclusiva y la elimina al terminar. Los escenarios comprueban edición en ambas direcciones, cambios externos, HCL inválido, conflictos de revisión y escritura durante una respuesta de guardado demorada. Los documentos completos se pegan mediante el portapapeles del contexto de Chromium de prueba para reproducir el comportamiento de Monaco. Se conserva el agente de usuario nativo del navegador para que los atajos de teclado coincidan con el sistema operativo.

Chromium se instala una vez con `make e2e-install`. En Linux CI se utiliza `npx playwright install --with-deps chromium` para instalar además las bibliotecas del sistema necesarias. Los reportes permanecen en `web/playwright-report/` y `web/test-results/`, fuera de Git.

Si Go no está en `PATH`, puedes indicar su ejecutable con `make check GO=/ruta/go/bin/go` y usar el mismo argumento en los demás objetivos. La comprobación de formato utiliza el `gofmt` de ese toolchain. Para las pruebas Go con `-race`, el entorno necesita un compilador C disponible; el runner Linux de CI lo incluye.

## Integración continua

El workflow [CI](../.github/workflows/ci.yml) corre en pull requests y pushes a `main` y `codex/**`. Usa permisos de solo lectura del repositorio y dos trabajos independientes: calidad/pruebas/build y flujos de navegador. El reporte Playwright se conserva durante siete días cuando está disponible.

La existencia del workflow no implica que haya corrido en GitHub: la ejecución remota comienza al publicar la rama o abrir el pull request. Las comprobaciones locales verificadas deben indicarse en la descripción del cambio.

## Ramas y entregas

```text
main
 └── codex/tema-concreto
       ├── implementación y pruebas
       ├── revisión del diff
       └── pull request → CI → revisión → main
```

Se mantiene una sola rama estable y ramas cortas por cambio. Las pruebas son parte de la rama de trabajo; no necesitan una rama permanente separada. Los tags de versión se reservan para entregas cuya compatibilidad y evidencia estén documentadas.

La rama inicial de la demo es `codex/interactive-demo`. Los cambios se preparan localmente; publicar la rama y fusionarla son acciones separadas del desarrollo.

## Ampliar el producto

Antes de añadir un tipo de recurso, identifica qué relaciones y propiedades puede interpretar TerraDock y cómo se comporta cuando una expresión no es resoluble. Añade fixtures, pruebas y una entrada en la matriz de compatibilidad. Mantén los componentes de presentación independientes de la lectura y escritura de HCL.

El [roadmap](roadmap.md) se conserva como planificación original con sus casillas pendientes. No se marcará una fase completa solo porque exista una pantalla que la represente.
