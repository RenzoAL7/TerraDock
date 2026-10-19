# Demo pública interactiva

Abre **http://193.122.221.201/demo/** o pulsa **Probar demo** en la portada. No requiere instalar TerraDock ni crear una cuenta.

## Recorrido de prueba

1. Selecciona la instancia `payments-api` en la arquitectura. En **Propiedades**, cambia `instance_type` de `t3.micro` a `t3.small` y pulsa el botón de aplicar junto al campo. El código y la tarjeta muestran el valor nuevo.
2. Edita directamente el HCL de la izquierda: cambia un CIDR, una etiqueta o una referencia entre recursos. El diagrama se vuelve a calcular desde el texto.
3. Pulsa **Ver en código** para enfocar y seleccionar la línea de declaración del recurso.
4. Elige el segundo ejemplo para explorar dos subredes y dos instancias. Selecciona sus recursos y observa sus referencias.
5. Prueba un error de sintaxis. Aparecen diagnósticos; la arquitectura queda marcada como la última vista válida y el inspector espera a que corrijas el texto.
6. **Descargar .tf** guarda el contenido actual como `terradock-demo.tf`. **Reiniciar ejemplo** restaura el ejemplo seleccionado. Recargar la página descarta los cambios en memoria.

En móvil, el código, la arquitectura y las propiedades se apilan. Todos los controles admiten teclado; el primer enlace permite saltar al editor.

## Alcance

- Un archivo `main.tf`, hasta 64 KiB, 1000 líneas y 60 declaraciones. Hay dos ejemplos iniciales editables.
- Análisis sintáctico HCL y relaciones estáticas entre recursos. No evalúa variables, funciones, módulos, proveedores, planes ni estados.
- Edición de literales compatibles mediante el mismo editor de la aplicación local; conserva el resto del código y sus comentarios. Las expresiones calculadas se muestran en lectura y se pueden editar como texto.
- El contenido permanece en la memoria de la pestaña. No se usan cookies, almacenamiento persistente, cuentas, credenciales o APIs cloud. No se ejecuta Terraform ni se crea infraestructura.
- Un fallo de descarga o un análisis que exceda 30 segundos permite reintentar sin descartar el texto. El navegador necesita acceso al sitio para cargar inicialmente sus assets.

## Construcción y servicio

Desde la raíz del checkout, con Go 1.25 o superior, Node.js 24 y npm:

```sh
npm --prefix web ci
npm --prefix web run build:public
npm --prefix web run preview:public
```

Abre `http://127.0.0.1:4174/demo/`. El directorio exacto que se sirve es **`web/dist-public/`**. `npm --prefix web run dev:public` arranca desarrollo en `http://127.0.0.1:5174/demo/`.

`scripts/build-public-demo.mjs` compila `cmd/terradock-demo` para `GOOS=js GOARCH=wasm` y copia el soporte JavaScript de la misma versión de Go. Incluye las licencias del runtime y de los módulos que utiliza. Los archivos generados viven en `web/src/demo/generated/`, están ignorados por Git y se incorporan al build público con nombres con hash.

`internal/publicdemo` limita las operaciones a análisis y edición en memoria mediante `internal/terraform`. Un Web Worker ejecuta ese módulo fuera del hilo de la interfaz. El contenedor final sirve archivos estáticos con Nginx; no ejecuta el backend Go ni necesita acceso a archivos del equipo del visitante.

## Verificación

```sh
go test ./internal/publicdemo ./internal/terraform
make check
make test
make build
make e2e
make public-e2e
```

La suite pública incluye 19 casos. Contra un servidor existente usa `PUBLIC_BASE_URL=http://193.122.221.201 npm --prefix web run test:public`: se ejecutan 18 casos y se omite únicamente la entrada de desarrollo. Los escenarios comprueban edición bidireccional, relaciones derivadas del código, errores, exportación, recuperación de carga, teclado y tamaños 320/390/768/1440 para la demo.

La guía de [publicación](public-deployment.md) documenta la imagen GHCR, las políticas del servidor y la actualización mediante Argo CD.
