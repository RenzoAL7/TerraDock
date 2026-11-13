# Arquitectura de la demo

TerraDock mantiene el proyecto en el equipo del usuario. El navegador presenta el editor y el diagrama; Go controla el acceso a archivos e interpreta Terraform con las bibliotecas HCL de HashiCorp. El frontend compilado se sirve junto a la API.

```mermaid
flowchart LR
  User[Usuario] --> UI[React y TypeScript]
  UI --> Editor[Editor Monaco]
  UI --> Canvas[Canvas React Flow]
  UI --> API[API Go en loopback]
  API --> Parser[Parser HCL]
  API --> FS[Archivos de la raíz permitida]
  Parser --> Model[Modelo con rangos y referencias]
  Model --> UI
  API -. pestaña Floci .-> Runner[Ejecutor Terraform]
  Runner --> Floci[Emulador Floci local]
```

## Responsabilidades

| Capa | Responsabilidad | Límite |
| --- | --- | --- |
| `cmd/terradock` | Opciones de arranque, servidor HTTP y apertura del navegador (`--open`) | No contiene lógica de interpretación |
| `internal/` | Modelo, interpretación, acceso al proyecto y API | Abrir, analizar y editar no ejecutan Terraform ni contactan AWS ni Floci |
| `internal/floci` | Estado del emulador y `terraform plan`, `apply` y `destroy` contra Floci, solo desde su pestaña | Endpoint de loopback o `*.floci.io` (debe resolver a tu equipo); copia privada; sin las variables `AWS_*` del usuario y, de las `TF_*`, solo `TF_CLI_CONFIG_FILE` y `TF_TOKEN_*`. `terraform init` descarga providers la primera vez en cada proyecto y `floci start` puede descargar su imagen Docker |
| `web/src/` | Navegación, borradores, editor, canvas e inspector | El diagrama se deriva del modelo interpretado |
| `web/embed.go` | Incrusta `web/dist` en el ejecutable con la etiqueta de build `embed` | Sin esa etiqueta (`web/noembed.go`), el frontend se lee de `--assets` |
| `examples/` | Entradas didácticas para probar el flujo | No son un despliegue verificado |
| `web/tests/` | Escenarios de usuario sobre servicios locales | No validan recursos en AWS |

## Modelo de Terraform

El análisis considera los `.tf` del directorio seleccionado como un módulo raíz. Cada recurso conserva su dirección, tipo, nombre y ubicación de origen. Las relaciones se extraen de referencias presentes en las expresiones; sus etiquetas y direcciones deben poder justificarse desde el código.

Además de los recursos, el modelo incluye fuentes de datos, módulos, variables, locals (una declaración por clave), outputs y proveedores. El campo `block` de cada declaración indica su clase, y su `id` usa la sintaxis con la que Terraform la referencia (`var.region`, `local.name`, `output.ip`, `provider.aws.west`), de modo que una referencia en el código resuelve directamente a su nodo. Cada propiedad que el inspector no edita lleva `readOnlyReason`, un motivo en español.

El parser interpreta sintaxis HCL. No sustituye el motor de evaluación de Terraform ni los esquemas de los proveedores. Los bloques con `count` o `for_each` son declaraciones; no se expanden a un número inventado de instancias. Los valores dependientes de variables, funciones o proveedores se mantienen como expresiones.

La edición desde el inspector se restringe a los literales reconocidos. Una operación debe apuntar al rango de la expresión original y verificar la revisión antes de escribir. El código no editado visualmente conserva su contenido. El [documento de limitaciones](limitations.md) delimita las garantías de esta demo y lo que falta para la edición fiable prevista en el roadmap.

## Dos contextos de trabajo

La interfaz permite explorar una demostración y abrir un proyecto local. El contexto activo debe ser visible. Las operaciones sobre un ejemplo temporal no deben hacerse pasar por una modificación de una carpeta del usuario.

En modo local, `--root` delimita el espacio accesible. Abrir una carpeta selecciona el módulo que se analizará dentro de esa raíz. No se agrega recursivamente cualquier `.tf` encontrado: cada módulo mantiene su contexto.

Al arrancar, `cmd/terradock` decide el primer proyecto: la carpeta indicada como argumento (o `--open-path`), que debe abrirse o el programa termina con un error; si no se indica, la raíz cuando contiene archivos `.tf`; y si no, el ejemplo en memoria. Sin `--root` explícito, la carpeta indicada también es la raíz permitida. Abrir un proyecto solo lee archivos; nunca ejecuta Terraform.

## Contrato de la API local

`GET /api/session` devuelve el token de sesión, `instanceId`, raíz permitida, modo y versión. Las mutaciones requieren `Content-Type: application/json` y el encabezado `X-TerraDock-Session`. El servidor comprueba el host de loopback y el origen; la excepción de desarrollo admite únicamente el origen exacto configurado y no habilita CORS.

| Petición | Datos relevantes |
| --- | --- |
| `GET /api/project` | Snapshot del proyecto activo |
| `GET /api/directories?path=...` | Directorios navegables dentro de la raíz |
| `POST /api/demo` | `template`: `basic-vpc` o `web-app`; abre una copia en memoria |
| `POST /api/open` | `path`: carpeta del módulo raíz |
| `PUT /api/files` | `projectId`, `path`, `content`, `expectedRevision` |
| `PATCH /api/properties` | `projectId`, `resourceId`, `property`, `value`, `expectedRevision` |
| `POST /api/analyze` | `projectId`, `files` (ruta → contenido del borrador); devuelve recursos, relaciones y diagnósticos sin escribir |
| `POST /api/edit-draft` | `projectId`, `path`, `content`, `resourceId`, `property`, `value`; devuelve el `content` editado sin escribir |
| `GET /api/floci` | Estado: endpoint, si el emulador responde, Terraform detectado y su versión, trabajo actual, plan, recursos desplegados y variables |
| `POST /api/floci/run` | `action` (`start`, `plan`, `apply`, `destroy` o `refresh`), `projectId`, `variables`; responde `202` con el trabajo, `409 floci_error` si hay otro en curso y `400 floci_error` ante una acción o un proyecto no válidos |
| `POST /api/floci/cancel` | Cuerpo `{}`; cancela el trabajo en curso |
| `GET /api/events` | Stream SSE con eventos `project` y snapshots completos |

`cmd/terradock` siempre crea el ejecutor de Floci; las rutas de Floci solo responden `503 floci_unavailable` cuando el servidor se construye sin él, como en algunas pruebas. La revisión esperada corresponde al hash del archivo de origen, también para editar una propiedad. El servidor verifica `projectId` bajo el mismo bloqueo que el guardado; una operación destinada al proyecto anterior recibe `409 project_conflict`, incluso cuando los dos proyectos contienen archivos con el mismo nombre y contenido. Una revisión obsoleta recibe `409 revision_conflict`. Las respuestas de error incluyen `code` y `error`.

## Orden de actualizaciones y borradores

Cada snapshot incluye `instanceId` y `sequence`. `instanceId` es un identificador público aleatorio de la instancia del gestor, independiente del token de autenticación. `sequence` aumenta con cada actualización publicada, incluido cambiar de ejemplo o carpeta, los errores de lectura y su recuperación. Cambiar de proyecto no reinicia la secuencia; iniciar otro proceso genera una identidad nueva.

HTTP y SSE pueden llegar en un orden distinto al de las operaciones. El cliente confirma la identidad mediante `/api/session` y compara las secuencias dentro de esa instancia para evitar que una respuesta tardía sustituya una vista más reciente. La respuesta concreta de un guardado conserva la revisión que produjo esa operación; una actualización posterior de otro cliente no autoriza a rebasar automáticamente un borrador sobre ella.

El servidor comparte un proyecto activo entre sus pestañas. Los borradores pertenecen a cada pestaña y conservan el proyecto y revisión desde los que comenzaron. Si una modificación deja HCL inválido, se muestran la nueva fuente y sus diagnósticos mientras el gráfico conserva la última configuración válida del proyecto. La observación de cambios externos usa eventos nativos del sistema de archivos (fsnotify) con un margen de 25 ms y una lectura periódica de respaldo cada 2 s (300 ms si no hay eventos nativos). No supone un plazo máximo de actualización garantizado.

Los borradores se analizan sin escribir en disco: `POST /api/analyze` recibe el contenido de los archivos con cambios y devuelve recursos, relaciones y diagnósticos, y `POST /api/edit-draft` aplica un literal del inspector sobre el texto del borrador. Ambos usan el mismo parser y editor que el guardado. El autoguardado del cliente persiste el borrador con `PUT /api/files` cuando la vista previa confirma que el HCL es válido, con la misma comprobación de revisión que un guardado manual. Los guardados de una pestaña se hacen de uno en uno; uno pedido mientras otro está en curso espera su turno.

Cada recurso del análisis lleva `line` y `endLine`: el bloque completo o, en un local, solo su atributo. El editor los usa para resaltar la declaración y para elegir el nodo según el cursor.

Cada pestaña copia sus borradores en IndexedDB bajo una clave propia (raíz, carpeta, archivo e identificador de pestaña), así que dos pestañas abiertas no se pisan. Las pestañas se avisan con `BroadcastChannel` de qué archivos tienen borradores, usando el mismo identificador; el canal se cierra en `pagehide` y se reabre si la página vuelve de la caché de navegación.

El paquete `internal/floci` ejecuta Terraform contra el emulador en una copia de trabajo, ubicada en la caché del usuario, que contiene los archivos guardados, los `tfvars` del proyecto y los archivos de override del provider `aws` y del backend `local`. El entorno del proceso no incluye las variables `AWS_*` del usuario ni sus `TF_*`, salvo `TF_CLI_CONFIG_FILE` y `TF_TOKEN_*` (mirrors y registros privados), y fija `CHECKPOINT_DISABLE=1`. `floci start` y `terraform version` reciben el entorno saneado sin ninguna `TF_*`. «Aplicar» solo ejecuta el archivo de plan generado para la misma huella de archivos.

El cliente solo pide `GET /api/floci` mientras la pestaña Floci está visible o hay una operación en curso, para que plan, aplicar y destruir sigan actualizando el diagrama aunque se salga de la pestaña. Ese estado comprueba si el endpoint responde y, una vez por proceso y fuera del bloqueo del ejecutor, lee `terraform version -json`; no se reintenta si falla. Como el estado no se refresca siempre, el diagrama no muestra marcas de un estado leído para otro proyecto y descarta las de un plan leído para una revisión guardada anterior.

## Desarrollo y build

Durante el desarrollo, Vite sirve el frontend en `127.0.0.1:5173` y reenvía la API al proceso Go en `127.0.0.1:7331`. `make dev-api` permite el origen exacto de Vite mediante `--dev-origin`; esa excepción es opcional y no se necesita para el build. Durante la ejecución del build, Go sirve los archivos de `web/dist` y la API desde un mismo puerto. Monaco y sus workers se incluyen en la compilación del frontend.

Hay dos formas de ejecutable:

- `make build` genera `bin/terradock`, que lee el frontend de `web/dist` (o de la ruta indicada con `--assets`). Es la forma que usan el desarrollo y las pruebas de navegador.
- `make package` (`scripts/package.sh`) compila con `-tags embed` un binario autocontenido por plataforma (macOS, Linux y Windows; ARM64 y AMD64) con el frontend incrustado, y genera `checksums.txt`. Ese binario abre el navegador al arrancar (`--open`, activo por defecto cuando el frontend va incrustado). Si se pasa `--assets`, usa esa carpeta en lugar de la copia incrustada.

El workflow [Binarios](../.github/workflows/release.yml) ejecuta `make package` en un runner ARM, prueba el binario linux/arm64 y crea el release en GitHub al publicar una etiqueta `v*`. Los archivos aparecen cuando se publica un release (etiqueta `v*`); si los enlaces todavía no descargan nada, aún no hay ninguno publicado y hay que compilar desde el código. Los instaladores, la firma de código y las actualizaciones automáticas son trabajo posterior.

## Decisiones deliberadas

- La interfaz corre en el navegador para evitar un runtime de escritorio adicional.
- Go comparte la responsabilidad del servidor y el análisis HCL para mantener las operaciones de archivos fuera del navegador.
- El diseño visual y el código se sincronizan mediante un modelo común con origen verificable.
- Terraform solo se ejecuta desde la pestaña Floci: una vez para leer su versión cuando se abre la pestaña, y al pulsar plan, aplicar, destruir o «Leer estado», siempre contra el emulador local. Abrir una carpeta, analizar o editar nunca lo ejecuta.
- La importación de planes JSON arbitrarios y la ejecución contra cuentas AWS reales quedan fuera de esta entrega.
- Se publica compatibilidad parcial antes de ampliar recursos o evaluación semántica.

Referencias técnicas: [HCL](https://github.com/hashicorp/hcl), [módulos Terraform](https://developer.hashicorp.com/terraform/language/files), [Monaco Editor](https://github.com/microsoft/monaco-editor) y [React Flow](https://reactflow.dev/).
