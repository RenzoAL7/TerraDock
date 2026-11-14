# Compatibilidad y límites

Esta entrega permite demostrar el flujo de un IDE local y sirve de base para desarrollar TerraDock. No completa el contrato de v1.0 del [roadmap](roadmap.md). Una presentación cuidada y pruebas automatizadas no sustituyen la verificación pendiente sobre proyectos, sistemas y escenarios de recuperación reales.

## Demo pública en el navegador

La entrada `/demo/` permite editar un único `main.tf` en memoria, seleccionar recursos, modificar literales compatibles, crear recursos de la paleta al final del archivo, navegar al código y descargar el resultado. Reutiliza el parser y el editor locales compilados a WebAssembly. No abre carpetas ni llama al servidor Go; los cambios se pierden al recargar. Tiene límites de 64 KiB, 1000 líneas y 60 declaraciones. Si el HCL es inválido, muestra diagnósticos y conserva la última vista válida identificada como tal, con el inspector deshabilitado.

La [guía de la demo pública](browser-demo.md) describe las acciones y la compilación. Las limitaciones de interpretación y ejecución de este documento también se aplican a esa entrada. Los límites de archivos, guardado y carpetas que siguen corresponden únicamente a la aplicación local.

## Alcance de la aplicación local

| Área | Alcance |
| --- | --- |
| Archivos | Terraform HCL en archivos `.tf` del módulo raíz seleccionado |
| Recursos | Recursos, fuentes de datos, módulos, variables, locals (un nodo por clave), outputs y proveedores (con alias), con sus referencias; presentación especializada para el ejemplo AWS y representación genérica cuando corresponde |
| Expresiones | Se conserva la expresión original; no se ejecutan funciones de Terraform ni consultas de proveedores |
| Editor | Edición de texto y guardado mediante el servicio local |
| Inspector | Edición limitada a valores literales compatibles; expresiones calculadas en lectura |
| Crear recursos | Paleta de 9 tipos AWS con sus atributos obligatorios; el bloque se añade al final de un `.tf` existente (como borrador) o en un archivo `.tf` nuevo |
| Carpetas | Navegación y apertura dentro de la raíz permitida por `--root` |
| Diagrama | Vista derivada de la configuración; relaciones estáticas, no estado de ejecución |
| Ejemplo | Configuración didáctica para probar la interfaz; sin despliegue AWS verificado |

## Límites de archivos y rutas

- Se leen como máximo **100 archivos `.tf` o `.tf.json`** del directorio seleccionado, sin fusionar los módulos de subcarpetas.
- Cada archivo admite hasta **2 MiB** y el conjunto hasta **20 MiB**; un MiB equivale a 1.048.576 bytes. Abrir o guardar contenido que exceda estos límites devuelve un error.
- El selector devuelve hasta 1.000 subcarpetas por ubicación y omite `.git`, `.terraform`, `node_modules` y enlaces simbólicos.
- Las carpetas seleccionadas deben quedar dentro de la raíz canónica de `--root`. Se rechazan escapes de ruta y componentes simbólicos dentro de esa raíz; un archivo `.tf` enlazado simbólicamente impide abrir ese módulo.
- Solo se guardan archivos regulares `.tf` ya presentes en el módulo abierto. La única forma de crear un archivo es **Crear recurso → Archivo nuevo…**: un nombre `.tf` sin carpetas ni espacios, junto a los demás archivos del módulo, que nunca reemplaza un archivo existente (ni sigue un enlace simbólico). No se renombran ni eliminan archivos desde la interfaz.
- Si otro programa crea, renombra o borra un `.tf`, el proyecto se actualiza solo. Un borrador de un archivo que ya no existe (por ejemplo, tras renombrarlo) queda huérfano: no se puede guardar con el nombre anterior ni vuelve a crear ese archivo, y la aplicación ofrece descargarlo.
- Estas comprobaciones delimitan el acceso normal de la aplicación; no constituyen un sandbox del sistema operativo frente a otros procesos locales.

## Interpretación

- No se expande el contenido de módulos locales o remotos; seleccionar una subcarpeta implica analizar ese módulo por separado.
- No se evalúa la precedencia de `.tfvars`, variables de entorno u opciones CLI.
- `count`, `for_each`, funciones y bloques dinámicos pueden conservarse como código; la demo no garantiza resolver su efecto. Un bloque con `count` o `for_each` lleva una marca en su nodo (`× 3`, `× var.n` o `for_each`) y se dibuja una sola vez.
- Las variables, los locals, los outputs y los proveedores son nodos de solo lectura: se muestran su valor por defecto o su expresión, pero no se evalúan ni se aplican `.tfvars`. Una referencia a una variable o un local no declarados aparece como aviso. Si una variable o un output declaran `sensitive = true`, o un local envuelve su valor en `sensitive(...)`, la tarjeta y el inspector muestran «(sensible)» en lugar del valor; el editor de código sigue mostrando el archivo tal cual. Un local que solo deriva de una variable sensible no se detecta, porque no se evalúan expresiones.
- La relación con un proveedor solo se dibuja cuando un recurso o un módulo lo nombra (`provider = aws.west`, `providers = { … }`); la asociación implícita por el prefijo del tipo no se dibuja.
- El inspector explica, en cada propiedad que no edita, el motivo: una referencia o variable, una función, una lista u objeto, `null`, un número que el navegador no representa con precisión, una propiedad fuera de la lista editable o un bloque que no es un recurso.
- Los archivos `.tf.json` aparecen en la lista de archivos, en solo lectura y con un aviso, pero su contenido no se interpreta: sus recursos no llegan al diagrama. Tampoco se copian a la ejecución de Floci, que sigue usando solo los `.tf`; la pestaña Floci lo avisa y nombra los archivos omitidos.
- No hay validación semántica con esquemas de proveedores. Un archivo sintácticamente correcto todavía puede resultar inválido para Terraform o AWS.
- Los nombres, las etiquetas y las relaciones dibujadas no demuestran conectividad, seguridad o disponibilidad de una infraestructura real.

## Edición y recuperación

La demo comprueba revisiones para detectar cambios sobre una versión distinta del archivo. Esto ayuda a evitar sobrescrituras obsoletas; no equivale a completar todos los escenarios de edición colaborativa, recuperación tras fallos de alimentación o modificaciones simultáneas de otros programas.

La escritura atómica y la comprobación previa tienen límites frente a herramientas externas que no comparten el mismo mecanismo de coordinación. La recuperación de historial y el cierre de todos los escenarios de la etapa 3 siguen pendientes. El repositorio debe conservar evidencia de los escenarios concretos que sí se prueban.

Cuando un archivo cambia en disco mientras tiene un borrador, el editor muestra una comparación (disco a la izquierda, borrador a la derecha) con tres acciones:

- **Conservar el mío** aplica tus cambios sobre la versión nueva del disco (fusión de tres vías por líneas) y la guarda con la revisión nueva. Solo ocurre si tus cambios y los externos no tocan las mismas líneas ni líneas contiguas; si las tocan, no se escribe nada y se abre el resultado con marcas `<<<<<<<`, `=======` y `>>>>>>>` para resolverlo a mano. Si otro guardado está en curso, este espera su turno y el editor muestra «Guardado pendiente».
- **Usar el del disco** descarta el borrador.
- **Editar el resultado** permite corregir el texto final; al aplicarlo queda como borrador sobre la versión del disco con la que se preparó y sigue el flujo normal de guardado. Si el archivo vuelve a cambiar mientras lo editas, se avisa y, al aplicar, la comparación aparece de nuevo con la versión más reciente: el cambio externo no se deshace en silencio.

La fusión compara líneas de texto, no la estructura HCL: dos cambios en líneas distintas de un mismo bloque se combinan aunque juntos no tengan sentido para Terraform. Con diferencias muy extensas (más de 2.000 líneas distintas) no se intenta combinar y se pide resolver a mano.

El guardado prepara un archivo temporal, conserva los bits de permisos, sincroniza su contenido y vuelve a comprobar la revisión antes de reemplazar el original. La comprobación y el reemplazo no son una transacción compartida con otros editores: existe una ventana de carrera. Las pruebas de `internal/workspace` fijan el comportamiento real en esa ventana:

- Si otro programa escribe el archivo mientras se prepara el temporal (hasta la última comprobación), el guardado se rechaza como conflicto, el archivo externo se conserva y el borrador sigue en la pestaña.
- Si la escritura externa cae entre la última comprobación y el reemplazo (un intervalo muy corto), gana el guardado de TerraDock y el cambio externo se pierde. Después, disco y aplicación coinciden.

No se promete preservar todos los metadatos del sistema de archivos ni recuperación frente a pérdida de alimentación.

Los borradores sin guardar se copian al **perfil del navegador** (IndexedDB) unos 400 ms después de dejar de escribir, y al ocultar o cerrar la pestaña. Cada borrador se identifica por la raíz de `--root`, la carpeta del proyecto (o el ejemplo), el archivo y la pestaña que lo escribió, y guarda la revisión y el texto del archivo del que partió. Dos pestañas abiertas nunca pisan ni borran la copia de la otra. Al volver a abrir ese proyecto, TerraDock ofrece **Restaurar borrador** si el archivo no cambió, o **Comparar con el disco** si cambió desde entonces. Si varias pestañas cerradas dejaron un borrador del mismo archivo, se ofrecen de uno en uno, del más reciente al más antiguo. Se borran al guardar o descartar. Los que llevan más de 7 días se eliminan al volver a abrir TerraDock en ese mismo origen (`http://127.0.0.1:<puerto>`); si no vuelves a abrirlo, siguen en el perfil. En **Ayuda**, **Borrar borradores guardados en este navegador** elimina las copias que dejaron pestañas cerradas; no toca las de la pestaña actual ni las de otras pestañas abiertas que hayan dado señales por `BroadcastChannel`. Una pestaña abierta que no respondió (por ejemplo, sin `BroadcastChannel`) puede perder su copia hasta su siguiente cambio.

- Quedan en el equipo, sin cifrar, en el perfil del navegador que usaste: otro navegador, otro perfil o una ventana privada no los ven. Borrar los datos del sitio los elimina.
- El almacenamiento es del origen, no de TerraDock: cualquier otra aplicación local servida en el mismo puerto puede leer y borrar estos borradores.
- Si el navegador no permite IndexedDB (algunos modos privados) o se queda sin espacio, la aplicación sigue funcionando sin esa copia; los borradores vuelven a vivir solo en la pestaña.
- Si escribes en un archivo que tiene un borrador por restaurar, el nuevo se guarda aparte y no reemplaza al anterior: este sigue ofrecido para **Descargar** o **Descartar** y solo se pierde si lo decides.
- La copia no sustituye a guardar: un cierre inesperado puede perder lo escrito en los últimos instantes.

Si otra pestaña cambia el proyecto, los borradores conservan su identidad original y no pueden guardarse silenciosamente sobre el nuevo proyecto. Las pestañas del mismo navegador se avisan (con `BroadcastChannel`, sin salir del navegador) cuando una tiene un borrador sin guardar de un archivo que la otra está mirando; ese borrador no se ofrece para restaurar mientras la otra pestaña siga abierta. Si una pestaña se cierra de forma inesperada, el aviso puede quedar hasta recargar.

### Crear un recurso desde el diagrama

- El bloque siempre se añade **al final** del archivo elegido; lo anterior se conserva byte a byte (también los saltos de línea CRLF). No se elige la posición ni se reordenan bloques.
- En un **archivo existente**, la inserción se aplica sobre su borrador si existe y, si no, sobre su versión guardada; el resultado es un borrador que llega al disco con el autoguardado o al guardar (⌘/Ctrl + S). Si un guardado de ese archivo termina mientras se prepara el bloque, se vuelve a preparar sobre la revisión recién guardada. El servidor rechaza la operación si el archivo cambió en disco desde la revisión del borrador, y la paleta no ofrece archivos cuyo borrador está en conflicto.
- Se rechaza un nombre que no sea un identificador HCL ASCII (letras, dígitos, `_` o `-`, empezando por letra o `_`, hasta 64 caracteres) y un `resource` con el mismo tipo y nombre en cualquier archivo `.tf` guardado del módulo. Un duplicado en el borrador sin guardar de **otro** archivo se detecta después, como diagnóstico, y pausa el autoguardado.
- El archivo de destino debe tener HCL válido. Un **archivo nuevo** se escribe en disco en cuanto se pulsa **Crear recurso**, sin pasar por borrador (en el ejemplo en memoria, solo en memoria); para quitarlo hay que borrarlo fuera de TerraDock, porque la interfaz no elimina archivos. Toma los permisos del primer `.tf` de la carpeta (o `0644` si no hay ninguno), y su nombre no puede ser un nombre de dispositivo de Windows (`con`, `prn`, `aux`, `nul`, `com0`–`com9`, `lpt0`–`lpt9`, con cualquier extensión) para que el módulo siga siendo portable.
- Las plantillas llevan los atributos obligatorios y algunos valores de partida (por ejemplo `t3.micro` o `10.0.1.0/24`), no recomendaciones de producción. El `bucket_prefix` de S3 se deriva del nombre en minúsculas, se recorta a los 37 caracteres que admite AWS y lleva delante `bucket-` si empezaría por un prefijo que S3 reserva (`xn--`, `sthree-`, `amzn-s3-demo-`); el diálogo avisa de ambos cambios. La base de datos RDS se crea cifrada (`storage_encrypted = true`) y destruible, para poder crearla y borrarla en Floci: `deletion_protection = false` y `skip_final_snapshot = true`. El diálogo lo recuerda: para AWS real, activa `deletion_protection` y quita `skip_final_snapshot`. Una referencia obligatoria sin destino (una subred sin VPC, una Lambda sin rol, una EC2 sin variable de AMI) se omite y el diálogo lo avisa: hay que completarla en el código antes de desplegar.
- **Deshacer** solo quita el bloque si el archivo sigue exactamente como quedó tras crearlo; si no, se quita en el código (⌘/Ctrl + Z en el editor también funciona mientras ese archivo está abierto).
- No se conecta arrastrando de un nodo a otro: las referencias se eligen en el diálogo al crear, o se escriben en el código.

Las propiedades no compatibles se editan desde el código. Una propiedad que referencia una variable no debe reemplazarse silenciosamente por un literal desde el inspector.

## Fuera de esta entrega

- Ejecutar Terraform fuera del emulador. `init`, `plan`, `apply` y `destroy` solo existen contra Floci, desde su pestaña y sobre una copia privada (ver el [README](../README.md#desplegar-en-local-con-floci-opcional)). No hay ejecución contra cuentas AWS reales ni un `validate` independiente.
- Importar un plan JSON arbitrario o comparar atributos con un estado Terraform. El plan generado contra Floci sí se muestra sobre el diagrama.
- Crear infraestructura mediante conexiones o movimientos del canvas.
- Análisis completo de seguridad, costos, rutas o impacto de cambios.
- Integración Git, colaboración multiusuario y sincronización en la nube.
- Instaladores, firma de código y actualizaciones automáticas. Los binarios autocontenidos para ARM64 y AMD64 en macOS, Linux y Windows ya se construyen (`make package` y el workflow Binarios), pero no están firmados: macOS y Windows muestran un aviso la primera vez. Los archivos aparecen cuando se publica un release (etiqueta `v*`); si los enlaces todavía no descargan nada, aún no hay ninguno publicado y hay que compilar desde el código.
- Certificación de funcionamiento en Windows y Linux de escritorio y pruebas con múltiples usuarios. La sincronización con 300 recursos sí está medida: el p95 queda por debajo de 1 s en una MacBook ARM con Chromium (ver [rendimiento](performance.md)), pero no en otras máquinas ni sistemas.

## Ejecución local

Go sirve la aplicación en loopback y la raíz elegida delimita el acceso a proyectos. No está diseñada para exponer el puerto a Internet ni para operar como un servicio multiusuario. El frontend y Monaco forman parte de los assets locales compilados.

En desarrollo se utilizan dos procesos y un proxy de Vite. Las dependencias Go/npm y la instalación inicial de Chromium requieren Internet; analizar y editar la configuración no requiere una cuenta AWS. Abrir, analizar y editar no ejecutan Terraform ni contactan Floci. Solo la pestaña Floci, mientras está visible o hay una operación en curso, consulta el emulador y lee una vez la versión de Terraform. El endpoint debe ser de loopback o `*.floci.io` (debe resolver a tu equipo). Plan, aplicar, destruir y «Leer estado» ejecutan `terraform init`, que necesita red para descargar providers la primera vez en cada proyecto, y «Iniciar Floci» puede descargar la imagen Docker del emulador si falta. Terraform y la CLI de Floci se ejecutan sin las variables `AWS_*` del usuario y con `CHECKPOINT_DISABLE=1`. De las variables `TF_*`, en plan, aplicar, destruir y «Leer estado» solo se respetan `TF_CLI_CONFIG_FILE` y `TF_TOKEN_*`, para usar mirrors de providers y registros privados. Se ignoran todas las demás, entre ellas `TF_VAR_*` (las variables se leen de los `tfvars` del proyecto o del panel), `TF_DATA_DIR`, `TF_WORKSPACE`, `TF_LOG` y `TF_PLUGIN_CACHE_DIR` (TerraDock usa su propia caché). `terraform version` y `floci start` no reciben ninguna.

## Estado del roadmap

La planificación original se copió a `docs/roadmap.md` conservando sus casillas. Las funciones incluidas en esta demo deben evaluarse contra los criterios de aceptación completos antes de marcar una etapa como terminada. No se presenta un porcentaje de avance basado en número de pantallas.
