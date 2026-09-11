# Compatibilidad y límites

Esta entrega permite demostrar el flujo de un IDE local y sirve de base para desarrollar TerraDock. No completa el contrato de v1.0 del [roadmap](roadmap.md). Una presentación cuidada y pruebas automatizadas no sustituyen la verificación pendiente sobre proyectos, sistemas y escenarios de recuperación reales.

## Alcance de la demo

| Área | Alcance |
| --- | --- |
| Archivos | Terraform HCL en archivos `.tf` del módulo raíz seleccionado |
| Recursos | Declaraciones de recursos y referencias reconocibles; presentación especializada para el ejemplo AWS y representación genérica cuando corresponde |
| Expresiones | Se conserva la expresión original; no se ejecutan funciones de Terraform ni consultas de proveedores |
| Editor | Edición de texto y guardado mediante el servicio local |
| Inspector | Edición limitada a valores literales compatibles; expresiones calculadas en lectura |
| Carpetas | Navegación y apertura dentro de la raíz permitida por `--root` |
| Diagrama | Vista derivada de la configuración; relaciones estáticas, no estado de ejecución |
| Ejemplo | Configuración didáctica para probar la interfaz; sin despliegue AWS verificado |

## Límites de archivos y rutas

- Se leen como máximo **100 archivos `.tf`** del directorio seleccionado, sin fusionar los módulos de subcarpetas.
- Cada archivo admite hasta **2 MiB** y el conjunto hasta **20 MiB**; un MiB equivale a 1.048.576 bytes. Abrir o guardar contenido que exceda estos límites devuelve un error.
- El selector devuelve hasta 1.000 subcarpetas por ubicación y omite `.git`, `.terraform`, `node_modules` y enlaces simbólicos.
- Las carpetas seleccionadas deben quedar dentro de la raíz canónica de `--root`. Se rechazan escapes de ruta y componentes simbólicos dentro de esa raíz; un archivo `.tf` enlazado simbólicamente impide abrir ese módulo.
- Solo se guardan archivos regulares `.tf` ya presentes en el módulo abierto. Esta demo no crea, renombra ni elimina archivos desde la interfaz.
- Estas comprobaciones delimitan el acceso normal de la aplicación; no constituyen un sandbox del sistema operativo frente a otros procesos locales.

## Interpretación

- No se expande el contenido de módulos locales o remotos; seleccionar una subcarpeta implica analizar ese módulo por separado.
- No se evalúa la precedencia de `.tfvars`, variables de entorno u opciones CLI.
- `count`, `for_each`, funciones y bloques dinámicos pueden conservarse como código; la demo no garantiza resolver su efecto.
- No se interpreta el formato alternativo `.tf.json` como un proyecto completo.
- No hay validación semántica con esquemas de proveedores. Un archivo sintácticamente correcto todavía puede resultar inválido para Terraform o AWS.
- Los nombres, las etiquetas y las relaciones dibujadas no demuestran conectividad, seguridad o disponibilidad de una infraestructura real.

## Edición y recuperación

La demo comprueba revisiones para detectar cambios sobre una versión distinta del archivo. Esto ayuda a evitar sobrescrituras obsoletas; no equivale a completar todos los escenarios de edición colaborativa, recuperación tras fallos de alimentación o modificaciones simultáneas de otros programas.

La escritura atómica y la comprobación previa tienen límites frente a herramientas externas que no comparten el mismo mecanismo de coordinación. La recuperación de historial, la resolución avanzada de conflictos y el cierre de todos los escenarios de la etapa 3 siguen pendientes. El repositorio debe conservar evidencia de los escenarios concretos que sí se prueban.

El guardado prepara un archivo temporal, conserva los bits de permisos, sincroniza su contenido y vuelve a comprobar la revisión antes de reemplazar el original. La comprobación y el reemplazo no son una transacción compartida con otros editores: existe una ventana de carrera. No se promete preservar todos los metadatos del sistema de archivos ni recuperación frente a pérdida de alimentación.

Los borradores viven en la memoria de la pestaña. Pueden descargarse para conservarlos, pero no existe recuperación persistente después de cerrar el navegador o reiniciar el equipo. Si otra pestaña cambia el proyecto, los borradores conservan su identidad original y no pueden guardarse silenciosamente sobre el nuevo proyecto.

Las propiedades no compatibles se editan desde el código. Una propiedad que referencia una variable no debe reemplazarse silenciosamente por un literal desde el inspector.

## Fuera de esta entrega

- Ejecución de `terraform init`, `validate`, `plan`, `apply` o `destroy`.
- Importación o comparación de planes y estados Terraform.
- Crear infraestructura mediante conexiones o movimientos del canvas.
- Análisis completo de seguridad, costos, rutas o impacto de cambios.
- Integración Git, colaboración multiusuario y sincronización en la nube.
- Binarios de release, instaladores y actualizaciones automáticas.
- Certificación de funcionamiento en Windows y Linux de escritorio, benchmark de 300 recursos y pruebas con múltiples usuarios.

## Ejecución local

Go sirve la aplicación en loopback y la raíz elegida delimita el acceso a proyectos. No está diseñada para exponer el puerto a Internet ni para operar como un servicio multiusuario. El frontend y Monaco forman parte de los assets locales compilados.

En desarrollo se utilizan dos procesos y un proxy de Vite. Las dependencias Go/npm y la instalación inicial de Chromium requieren Internet; analizar y editar la configuración no requiere una cuenta AWS. La instalación de nuevas dependencias y las futuras operaciones Terraform tendrán contextos de red distintos del análisis de archivos.

## Estado del roadmap

La planificación original se copió a `docs/roadmap.md` conservando sus casillas. Las funciones incluidas en esta demo deben evaluarse contra los criterios de aceptación completos antes de marcar una etapa como terminada. No se presenta un porcentaje de avance basado en número de pantallas.
