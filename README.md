# TerraDock

**Tu infraestructura, conectada con su código.**

TerraDock es un IDE visual de Terraform que funciona en tu equipo. Abre una carpeta, explora los recursos y sus relaciones, y navega entre el diagrama, el editor y las propiedades. Un servidor local en Go interpreta HCL y sirve la interfaz React en el navegador.

Esta entrega es una **demo funcional en desarrollo**. Su alcance y sus límites están publicados; el [roadmap de v1.0](docs/roadmap.md) describe trabajo futuro, no una lista de capacidades ya terminadas.

![TerraDock con explorador de recursos, diagrama AWS e inspector de propiedades](docs/screenshots/workspace.png)

## Página pública de presentación

La [portada pública](https://terradock.renzoaguilar.dev/) tiene una entrada React independiente y enlaza una [demo interactiva en el navegador](https://terradock.renzoaguilar.dev/demo/). Puedes editar el HCL, seleccionar recursos, cambiar propiedades literales y descargar tu ejemplo. El análisis funciona en memoria; no necesita una cuenta ni llama a la API Go o a proveedores cloud. El acceso y las integraciones pendientes siguen identificados como futuros.

Para construir ambas páginas necesitas Go 1.25 o superior, Node.js 24 y npm:

```sh
npm --prefix web ci          # Solo si faltan las dependencias
make public-build           # Salida: web/dist-public/
make public-preview         # http://127.0.0.1:4174
```

Sirve **solo `web/dist-public/`**, que contiene la portada y `/demo/`. El resultado es estático y no requiere un servidor Go. La aplicación local conserva su entrada y su salida `web/dist/`. Consulta la [guía de la demo pública](docs/browser-demo.md), los [comandos de la portada](docs/public-landing.md) y el [despliegue en GHCR/K3s](docs/public-deployment.md). Cada push a `main` que cambia la portada construye una imagen ARM64, la prueba y la promueve automáticamente a K3s-Cortex. Un monitor revisa el sitio cada 3 horas.

## Probar la demo

Requisitos para compilar: **Go 1.25 o superior**, **Node.js 24**, npm y Make. La primera instalación descarga dependencias. No necesitas Terraform ni credenciales AWS para analizar los ejemplos.

```sh
git clone https://github.com/RenzoAL7/TerraDock.git
cd TerraDock
make install
make build
make run
```

Abre [http://127.0.0.1:7331](http://127.0.0.1:7331). Prueba el ejemplo de la interfaz o pulsa **Abrir carpeta** para elegir una configuración local. El directorio desde el que arrancas el programa delimita la navegación disponible.

Para trabajar con otra carpeta:

```sh
./bin/terradock --root /ruta/a/tus/proyectos --assets ./web/dist --port 7331
```

`--root` define el directorio permitido para abrir proyectos; `--assets` apunta al frontend compilado. El proceso escucha en loopback. Para detenerlo, pulsa `Ctrl+C` en su terminal. Mantén `bin/terradock` y `web/dist` si mueves la aplicación; esta entrega todavía no empaqueta el frontend en un único ejecutable.

## Qué puedes explorar

- Un espacio de trabajo con explorador, código, arquitectura e inspector.
- Recursos declarados en los archivos `.tf` del módulo seleccionado y relaciones extraídas de sus referencias.
- Navegación desde un recurso hasta su bloque de origen.
- Edición de código y de propiedades literales compatibles.
- Diagnósticos de sintaxis y estados explícitos de guardado.
- Dos ejemplos editables en memoria para experimentar con la interacción entre código y gráfico.
- Observación de cambios externos y protección contra guardados obsoletos.

## Sincronización en tiempo real

Código y diagrama se mantienen al día en ambos sentidos, sin pulsar Guardar:

- **Código → diagrama:** al escribir en el editor, el diagrama, el inspector y el análisis se recalculan sobre el borrador (unos 60 ms después de la última tecla). Si el HCL queda inválido, el diagrama conserva la última versión válida y muestra los errores.
- **Diagrama → código:** al cambiar una propiedad literal en el inspector, se aplica al texto del archivo y el editor la muestra de inmediato.
- **Archivo → diagrama:** los cambios que haces con otro editor (VS Code, vim…) llegan al instante gracias a eventos nativos del sistema de archivos, con un sondeo de respaldo.
- **Autoguardado:** está activo por defecto. Escribe en el archivo cuando el borrador es HCL válido. Si otro programa modificó el archivo, se detiene y conserva tu borrador. Puedes desactivarlo desde el editor y guardar con ⌘/Ctrl + S.
- En la vista dividida, al seleccionar un nodo se marca su bloque en el código y, al mover el cursor por el código, se selecciona el recurso correspondiente.

## Despliegue local con Floci

La pestaña **Floci** ejecuta `terraform plan`, `apply` y `destroy` contra [Floci](https://floci.io), un emulador local de AWS. Requisitos: Docker, la CLI `floci` y Terraform u OpenTofu en el `PATH`.

```sh
floci start                 # o el botón «Iniciar Floci» del panel
./bin/terradock --root ~/proyectos --floci-endpoint http://localhost:4566
```

- El plan marca cada nodo del diagrama con su acción (`+ crear`, `~ actualizar`, `± reemplazar`, `− eliminar`). Después de aplicar, los nodos presentes en el estado aparecen como `✓ en Floci`.
- «Aplicar» ejecuta exactamente el plan revisado. Si los archivos cambian, el plan queda desactualizado y hay que generar otro.
- Terraform se ejecuta sobre una **copia privada** de los archivos guardados, ubicada en la caché del usuario. Tu carpeta no se modifica. Los endpoints, las credenciales de prueba y el backend local solo existen en esa copia, y se descartan las variables `AWS_*` reales del entorno.
- Las variables se leen de `terraform.tfvars` y `*.auto.tfvars`. Las que faltan se pueden escribir en el panel y se guardan solo en memoria.
- Solo se aceptan endpoints locales (`localhost`, `127.0.0.1` o `*.floci.io`).

El diagrama representa **configuración declarada**. No acredita infraestructura desplegada ni predice acciones de un plan. Las expresiones que requieren contexto de Terraform se conservan sin inventar valores. Consulta la [matriz de compatibilidad y limitaciones](docs/limitations.md) antes de usar un proyecto real.

## Desarrollo

Ejecuta estos comandos en dos terminales desde la raíz del repositorio:

```sh
# Terminal 1: API local
make dev-api
```

```sh
# Terminal 2: frontend con recarga
make dev-web
```

Abre [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite reenvía `/api` al servicio Go; `make dev-api` autoriza ese origen de desarrollo. En el build local, Go sirve ambos desde el mismo puerto.

```sh
make check       # Formato, análisis estático y tipos
make test        # Pruebas Go y frontend
make e2e-install # Instalar Chromium de Playwright una vez
make e2e         # Flujos de navegador con servicios de prueba
```

La [guía de desarrollo](docs/development.md) explica la estructura, la estrategia de pruebas y el flujo de ramas.

## Estructura

```text
TerraDock/
├── cmd/terradock/       # Entrada del programa y opciones de arranque
├── internal/           # Parser HCL, modelo y servicio HTTP
├── examples/           # Configuraciones Terraform de demostración
├── web/
│   ├── src/            # Interfaz React, editor y canvas
│   ├── tests/          # Flujos de navegador
│   └── package.json    # Dependencias y tareas del frontend
├── docs/               # Arquitectura, desarrollo, límites y roadmap
├── scripts/            # Comprobaciones de desarrollo compartidas
├── .github/            # CI y plantilla de pull request
├── Makefile            # Entrada común a build, desarrollo y pruebas
└── CONTRIBUTING.md     # Convenciones para contribuir
```

Las pruebas Go viven junto al código que verifican; las pruebas del frontend acompañan sus módulos y los escenarios de navegador están separados. No es necesario copiar el código a una carpeta de “pruebas”.

## Contribuir

`main` es la rama de integración estable. Cada cambio se desarrolla en una rama corta, por ejemplo `codex/interactive-demo`, y se revisa mediante pull request después de pasar CI. La política completa está en [CONTRIBUTING.md](CONTRIBUTING.md).

- [Arquitectura](docs/architecture.md)
- [Desarrollo y pruebas](docs/development.md)
- [Evidencia de validación de la demo](docs/validation.md)
- [Compatibilidad y límites](docs/limitations.md)
- [Roadmap del producto](docs/roadmap.md)

## Licencia

[MIT](LICENSE).
