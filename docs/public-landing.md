# Página pública de TerraDock

La portada presenta el producto, un ejemplo estático con código a la izquierda y arquitectura a la derecha, el recorrido de la demo local y las funciones web previstas. **Probar demo** abre una entrada interactiva independiente en `/demo/`; su [guía](browser-demo.md) explica las acciones disponibles. El acceso aparece deshabilitado y rotulado **Próximamente**. Los enlaces a GitHub llevan al repositorio y a su documentación, sin conectar una cuenta.

La primera entrega cubrió los archivos locales, el build y las pruebas. La publicación posterior autorizada usa una imagen estática independiente y K3s; consulta [despliegue público](public-deployment.md). La portada no incluye cuentas ni ejecución de Terraform.

## Entrada y salida independientes

Desde la raíz del checkout, con Go 1.25 o superior y Node.js 24:

```sh
npm --prefix web ci          # Primera instalación; Node.js 24 o superior
make public-dev             # Desarrollo: http://127.0.0.1:5174
make public-build           # Compilación estática
make public-preview         # Revisión del build: http://127.0.0.1:4174
```

El comando directo de compilación es `npm --prefix web run build:public`. Compila el analizador a WebAssembly y construye las dos entradas React. El **único directorio de salida público es `web/dist-public/`**, con `index.html`, `demo/index.html` y `assets/`. En el checkout usado para esta entrega corresponde a:

```text
/Users/renzo/Documents/ChatGPT/TerraFlow/TerraDock/web/dist-public/
```

Se puede servir ese directorio con un servidor HTTP estático, sin instalar Go, Terraform o variables de entorno en el servidor. El analizador compilado se descarga únicamente al entrar en la demo. `make public-preview` sirve ese mismo build con Vite en loopback; es una previsualización local, no una publicación. Para detenerla usa `Ctrl+C`.

`web/public-site/index.html` carga `web/public-site/main.tsx`, que importa únicamente los componentes de `web/src/landing/`. `web/public-site/demo/index.html` carga la demo de `web/src/demo/`. `web/vite.public.config.ts` define las dos entradas, su raíz y salida, sin heredar el proxy `/api` del editor. `publicDir: false` evita copiar recursos de otra aplicación. Se usan rutas de assets relativas; las páginas no necesitan rutas de SPA ni reescrituras de `/api` a `index.html`. El servidor de producción debe servir exclusivamente el directorio público y responder 404 a las rutas inexistentes.

`make build`, `make run`, `web/index.html`, `web/src/main.tsx`, `web/vite.config.ts` y `web/dist/` siguen correspondiendo a la aplicación local. No se debe publicar esa aplicación ni su servidor de archivos para servir la portada.

## Componentes y recursos

- `LandingPage.tsx`: navegación, explicación, cómo funciona, capacidades actuales y futuras, enlaces y pie de página.
- `EditorExample.tsx`: muestra didáctica de tres recursos declarados. No importa Monaco, React Flow ni el cliente de la API. El HCL es un fragmento ilustrativo, no una configuración preparada para ejecutar.
- `styles.css`: sistema visual y adaptación a escritorio, tablet y móvil.
- Manrope, IBM Plex Mono e iconos: dependencias ya existentes, empaquetadas localmente. Las licencias de las fuentes se incluyen en el build y están enlazadas en el pie de página. No se añadieron dependencias ni recursos de CDN.

Se tomó como referencia la portada y la vista dividida de `TerraDock-codex-local/mockups/`, recibidas en el Escritorio, junto con `objetivos.md` e `instrucciones-Codex-local.md`. Su HTML/JS de simulación no se incorpora al producto. Los objetivos posteriores quedan como contexto.

## Interacciones y accesibilidad

- **Probar demo** y **Abrir demo interactiva** llevan a `/demo/`, donde el código y las propiedades sí son editables.
- **Cómo funciona** y **Funciones** llevan a secciones reales. La navegación sigue visible en móvil.
- El primer enlace de teclado permite saltar al contenido. Enlaces y regiones enfocables tienen indicador de foco.
- En pantallas estrechas, solo el interior del ejemplo puede desplazarse horizontalmente, conservando código a la izquierda y arquitectura a la derecha. Hay una indicación visible; la región admite Tab y flechas del teclado, además del gesto táctil.
- La muestra incluye una descripción textual de la arquitectura y un aviso permanente sobre su carácter ilustrativo.
- Se respeta la preferencia de movimiento reducido. La portada no simula cuentas; los controles de edición están en la demo y modifican su contenido en memoria.

## Validación

```sh
make check
make test
make build
make e2e                    # Regresiones de la aplicación local
make public-e2e             # Compila y prueba la portada aislada
git diff --check
```

`make public-e2e` necesita Chromium (`make e2e-install` si no está instalado). Sirve el build estático en `127.0.0.1:4174` y comprueba también la entrada de desarrollo en `127.0.0.1:5174`; no arranca el servidor Go. Ambos puertos deben estar libres. Las regresiones de la app local usan el puerto 7332 y una configuración separada para no mezclar la API local con la portada.

La suite pública comprueba ausencia de llamadas `/api`, recursos externos, errores de navegador, cookies o almacenamiento local; disponibilidad de fuentes y assets; 404 en rutas privadas; destinos de enlaces; estado futuro del acceso; navegación por teclado; ausencia de desbordamiento de página y disposición izquierda/derecha en 320, 390, 601, 768, 1024 y 1440 px. La demo añade edición de código/propiedades, actualización de relaciones, errores HCL, exportación, reinicio y recuperación tras un fallo de carga. Produce capturas en `web/test-results/public/` y un informe en `web/playwright-report/public/`, ambos ignorados por Git.

Resultados y capturas revisadas: [validación de esta entrega](public-landing-validation.md).
