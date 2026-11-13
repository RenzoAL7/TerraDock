# TerraDock — Roadmap de producto

Estado: en desarrollo, preview funcional. Última revisión: 12 de noviembre de 2026. Las casillas marcadas `[x]` están implementadas y cubiertas por pruebas en `main`. Las demás siguen pendientes o solo están parcialmente resueltas.

La meta es un IDE visual de Terraform que se ejecuta en el navegador, servido por un programa local en Go. El usuario inicia el programa, abre una carpeta y trabaja sobre sus archivos originales. El frontend, el análisis y el guardado funcionan en su PC.

**Producto completo v1.0:** una persona puede instalar la herramienta, abrir un proyecto AWS dentro de la compatibilidad publicada, comprenderlo, editar código y propiedades compatibles, revisar cambios y planes importados, consultar hallazgos básicos y continuar su trabajo sin perder archivos ni modificaciones.

El 100 % se medirá contra este contrato y la lista de aceptación final. La visión posterior tiene hitos independientes y no es un requisito oculto de v1.0.

## Decisiones tomadas

- **Modelo de producto:** proyecto **open source (MIT)** que se ejecuta **en local**. El código vive en GitHub y la herramienta se descarga y ejecuta en el equipo del usuario. No es un servicio web alojado: no tiene cuentas ni sube archivos.
- **Web pública como escaparate:** https://terradock.renzoaguilar.dev sirve la portada y una demo en el navegador (analizador Go compilado a WebAssembly, en memoria). No se conecta al servidor local ni a las carpetas del visitante.
- **Prioridad de producto:** la **sincronización en tiempo real en ambos sentidos** entre archivo, código y diagrama. Ninguna funcionalidad nueva debe degradar su latencia ni su fiabilidad.
- **Orden:** primero que funcione bien en local, después las integraciones. La primera integración es **Floci**, un emulador local de AWS (etapa V8), que adelanta parte de V1.
- **Entrega de la portada:** imágenes **solo `linux/arm64`**, construidas en un runner ARM nativo. Se publican en GHCR por digest y se promueven automáticamente a `RenzoAL7/K3s-Cortex`, donde Argo CD las despliega. Un monitor revisa el sitio cada 3 horas. Ver [publicación](public-deployment.md).

## Estado actual

| Área | Estado |
| --- | --- |
| Núcleo técnico (fase 1) | Completo: parser HCL, modelo vinculado a la fuente, edición de literales preservando bytes y detección de cambios externos. |
| IDE local (fase 2) | Mayormente completo. Faltan proyectos recientes y la gestión de archivos (crear, renombrar, eliminar). |
| Edición bidireccional (fase 3) | Núcleo completo y **en tiempo real**: código → diagrama mientras se escribe, inspector → código al instante, archivo externo → diagrama con eventos nativos y autoguardado de HCL válido con control de revisión. Falta el historial, la comparación de conflictos y la recuperación tras una interrupción. |
| Proyectos habituales (fase 4) | Pendiente. Solo se leen los `tfvars` del proyecto para Floci. |
| Planes (fase 6) | Parcial por otra vía: el plan generado contra Floci se muestra sobre el diagrama. Todavía no se importa un JSON arbitrario. |
| Demo y portada (fase 8) | Publicadas en el dominio, con el núcleo compartido vía WebAssembly. |
| Floci (V8) | En curso: iniciar, plan, aplicar el plan revisado, leer estado y destruir; marcas por nodo; variables. Verificado contra Floci 1.5.33. |

## 0. Cerrar el contrato antes de desarrollar

**Funcionalidades y decisiones**

- [x] Primer usuario: persona con conocimientos básicos o intermedios de Terraform y AWS.
- [x] Flujo principal: iniciar programa → navegador local → Abrir carpeta → código y arquitectura → editar → guardar → sincronizar.
- [ ] Un proyecto activo por sesión al principio; proyectos recientes para cambiar de carpeta.
- [x] Selector de carpetas dentro de la interfaz, respaldado por Go, con opción de pegar una ruta.
- [x] Stack propuesto: Go, HCL, React, TypeScript, Vite, Monaco y React Flow. El diagrama coloca los nodos en una rejilla fija; un motor de layout automático queda pendiente para cuando sea necesario.
- [x] Definir la política de guardado. Decisión: cambios en vivo y autoguardado de borradores con HCL válido (desactivable), además de Guardar/Ctrl-S/Cmd-S. El diagrama refleja el borrador y los borradores se indican explícitamente.
- [ ] Diseñar pantalla inicial, explorador, pestañas, vista dividida, inspector, panel de problemas y estados.
- [ ] Definir por separado lectura de código, representación especializada y edición visual de propiedades.
- [ ] Fijar la política para módulos locales fuera de la raíz elegida: acceso adicional explícito o referencia sin abrir. No ampliar silenciosamente el ámbito de lectura o escritura.
- [ ] Confirmar sistemas operativos, arquitecturas y navegadores del primer lanzamiento. Propuesta: desarrollar primero en macOS y verificar macOS, Windows y Linux antes de anunciar soporte para los tres.
- [x] Elegir licencia y canales de distribución. MIT; código fuente en GitHub. Los binarios versionados están en la fase 9.

**Terminado cuando:** existe una especificación corta, una matriz inicial de compatibilidad y proyectos de prueba que representan el comportamiento esperado. Entonces se puede crear el repositorio y comenzar el desarrollo aprobado.

## 1. Probar el núcleo técnico

**Funcionalidades**

- [x] Leer los archivos `.tf` del módulo raíz, repartidos entre varios archivos.
- [x] Identificar `aws_vpc`, `aws_subnet` y `aws_instance`.
- [x] Conservar dirección, tipo, nombre, archivo, rango de origen y expresión de cada propiedad.
- [x] Extraer referencias directas y dependencias explícitas.
- [x] Construir un modelo interno vinculado con la sintaxis original.
- [x] Mostrar otros recursos como nodos genéricos; ningún bloque se elimina por falta de soporte visual.
- [x] Dibujar VPC → subnet → EC2 a partir de referencias identificables.
- [x] Cambiar un literal compatible desde la interfaz y guardar el archivo original.
- [x] Detectar guardados externos, incluidos los que reemplazan el archivo.
- [x] Mostrar errores de sintaxis sin cerrar la aplicación.

**Terminado cuando:** guardar un cambio en un editor externo actualiza el canvas; guardar una propiedad actualiza el archivo; el diff demuestra que el contenido ajeno al cambio se conserva; una expresión no compatible queda en lectura.

**Demostración:** cambiar el CIDR de una subnet de `10.0.1.0/24` a `10.0.2.0/24` dentro de una VPC `10.0.0.0/16`. Los ejemplos del parser y los templates desplegables se identifican por separado.

**Dependencia:** no ampliar el catálogo de recursos hasta verificar lectura, edición y recuperación del núcleo.

## 2. Convertirlo en un IDE local usable

**Funcionalidades**

- [x] Un programa sirve frontend y API en el mismo puerto local. Los binarios de release llevan el frontend incrustado (`web/embed.go`) y abren el navegador al arrancar (`--open`).
- [x] Puerto configurable con `--port` (las pruebas de navegador usan el 7332) e instrucciones de inicio y cierre en el README.
- [ ] Mensaje claro si el puerto está ocupado. Hoy se muestra el error del sistema operativo.
- [ ] Botón Abrir carpeta, navegación de directorios, ruta manual y proyectos recientes.
- [ ] Detectar ausencia de archivos Terraform en la carpeta, permisos insuficientes y carpetas con varios entornos; permitir elegir la raíz adecuada.
- [ ] Explorador con archivos y carpetas, búsqueda de archivos y apertura en pestañas.
- [ ] Crear y renombrar archivos de trabajo; eliminación explícita y recuperable, con conflictos gestionados. Estas operaciones no implican refactorización automática de referencias Terraform.
- [x] Monaco con edición, resaltado HCL, búsqueda, deshacer/rehacer y guardado.
- [x] Vistas Arquitectura, Código y Dividida.
- [x] Navegación de nodo a declaración y de declaración a nodo. En la vista dividida, el cursor selecciona el recurso y el nodo resalta su bloque.
- [ ] Inspector con valor o expresión, ubicación de origen y motivo cuando una propiedad no es editable visualmente.
- [x] Canvas con selección, zoom, desplazamiento, ajustar a pantalla, búsqueda y colocación en rejilla fija (sin layout automático).
- [x] Estados separados: borrador sin guardar, guardando, sincronizado, analizando, gráfico desactualizado y validación.
- [x] Panel de problemas con archivo, línea y explicación.

**Terminado cuando:** una persona puede iniciar la herramienta, elegir una carpeta y explorar y editar un proyecto sin recargar manualmente la página ni tener que usar un segundo editor.

**Límite:** incorporar Monaco no implica disponer automáticamente de autocompletado semántico o refactorización Terraform. Estas capacidades se evalúan más adelante.

## 3. Completar la edición bidireccional fiable — MVP

**Funcionalidades**

- [x] Lista explícita de propiedades editables y tipos aceptados; empezar con literales escalares.
- [x] Guardado de código libre conservando los bloques que TerraDock no interpreta.
- [x] Comparación de versión/contenido antes de aplicar modificaciones.
- [ ] Probar expresamente un cambio externo que ocurre durante el guardado; la comparación previa y el reemplazo atómico no bastan por sí solos. Definir cómo detectar el conflicto y conservar las versiones recuperables antes de prometer ausencia de pérdida de cambios.
- [x] Manejo de cambios externos cuando el editor tiene borradores pendientes.
- [x] Coordinación entre un borrador del editor y una edición del inspector sobre el mismo archivo. El inspector edita el mismo borrador y reintenta si el código cambió durante la petición.
- [ ] Conflictos visibles, comparación y opciones de conservar, recargar o resolver.
- [x] Escritura mediante reemplazo seguro, manejo de fallos y confirmación de éxito antes de mostrar Guardado.
- [ ] Historial acotado o recuperación de cambios propios, sin sobrescribir versiones externas nuevas al restaurar.
- [ ] Advertencia al cambiar de proyecto o cerrar con trabajo pendiente; recuperación de borradores ante interrupciones.
- [ ] Manejo de renombrado, eliminación y creación externa de archivos.
- [x] Eventos con revisiones para evitar bucles y estados antiguos tras reconectar.
- [ ] Coordinación entre dos pestañas de navegador abiertas sobre el mismo proyecto.
- [x] Último gráfico válido claramente marcado como desactualizado cuando el código es inválido.

- [x] **Sincronización en tiempo real (prioridad):** código → diagrama mientras se escribe (`POST /api/analyze`, sin escribir en disco), inspector → código al instante (`POST /api/edit-draft`), archivo externo → diagrama con fsnotify y sondeo de respaldo (menos de 300 ms medidos), y autoguardado que espera a que el HCL sea válido.

**Terminado cuando:** los escenarios de conflicto y fallo conservan el trabajo del usuario, la recuperación funciona y las pruebas no detectan sobrescrituras silenciosas de cambios externos.

**MVP alcanzado:** Abrir carpeta → ver recursos → editar código → actualizar gráfico → editar propiedad compatible → guardar en el archivo original, con estados y errores correctos.

## 4. Comprender proyectos Terraform habituales

**Funcionalidades**

- [ ] Mostrar variables, locals, outputs y data sources, con navegación a su declaración.
- [ ] Conservar expresiones, funciones, interpolaciones y referencias no resueltas.
- [ ] Distinguir valor literal, valor predeterminado, valor evaluado en un contexto conocido y valor desconocido.
- [ ] Si se interpretan `.tfvars`, definir el contexto y precedencia aplicados; no asumir que cualquier archivo `.tfvars` se carga automáticamente. Por ahora solo el ejecutor de Floci copia `terraform.tfvars` y `*.auto.tfvars`, que Terraform carga por defecto, y no los evalúa en el diagrama.
- [ ] Navegar llamadas a módulos locales, conservando sus límites y direcciones.
- [ ] Identificar módulos remotos no disponibles. Lectura opcional de fuentes instaladas, sin editar cachés de terceros ni descargarlas al abrir un proyecto.
- [ ] Representar bloques con `count` y `for_each` sin inventar instancias; usar el plan para mostrar instancias planificadas.
- [ ] Identificar configuración y alias de proveedores.
- [ ] Indicar soporte parcial de bloques dinámicos y construcciones no evaluadas.
- [ ] Documentar compatibilidad de `.tf.json`; propuesta inicial: detectarlo e indicar que no se interpreta, sin ocultar que el proyecto es parcial.
- [ ] Mantener una matriz con ejemplos para lectura, visualización, evaluación y edición.

**Terminado cuando:** un proyecto con varios archivos, variables y módulos locales se puede recorrer; lo no resuelto permanece visible; las direcciones no colisionan entre módulos.

**Fundamento:** Terraform trata los archivos de un directorio como un módulo; las subcarpetas no se incorporan automáticamente. [Estructura de Terraform](https://developer.hashicorp.com/terraform/language/files)

## 5. Ampliar AWS y la navegación del gráfico

**Cobertura visual propuesta**

| Grupo | Recursos y relaciones prioritarios |
| --- | --- |
| Red básica | VPC, subnet, Internet Gateway, route table, route y route table association |
| Reglas de red | Security group, reglas inline, `aws_security_group_rule` y reglas ingress/egress independientes |
| Salida a Internet | NAT Gateway y EIP |
| Cómputo | EC2, launch template y Auto Scaling Group |
| Balanceo | ALB, listener, target group y asociaciones de targets |
| Base de datos | RDS y DB subnet group |
| Almacenamiento | S3 y sus bloques de configuración relacionados, según matriz publicada |

**Funcionalidades**

- [ ] Agrupación por VPC, subnet y módulo cuando los datos permiten justificarla.
- [ ] Vistas de arquitectura y dependencias con leyenda y dirección de las relaciones.
- [ ] Inspeccionar por qué existe una relación y qué atributo la origina.
- [ ] Colapsar grupos, filtrar recursos y centrar resultados.
- [ ] Guardar posiciones y preferencias separadas del código Terraform.
- [ ] Mostrar dependencias directas y transitivas como relaciones potencialmente relevantes, sin afirmar cambios de despliegue.
- [ ] Comparar con una instantánea de configuración elegida: bloques agregados, eliminados y modificados.
- [ ] Exportar el gráfico a SVG o PNG con vista y alcance identificados.

**Terminado cuando:** los ejemplos de red y aplicación web se entienden sin una maraña de conexiones; las relaciones tienen evidencia; los filtros no hacen pasar un gráfico parcial por completo.

**Límite:** representación visual especializada no significa que todas las propiedades sean editables. Mover un nodo solo cambia su presentación.

## 6. Revisar planes de Terraform

**Funcionalidades de v1.0**

- [ ] Importar localmente un JSON obtenido mediante `terraform show -json`.
- [ ] Reconocer si el documento contiene un plan o un estado; rechazar con explicación los estados mientras no se soporten. No presentarlos como cambios previstos.
- [ ] Mostrar crear, modificar, eliminar, reemplazar, leer y sin cambios según corresponda.
- [ ] Inspeccionar diferencias de atributos y navegar a la dirección afectada.
- [ ] Mostrar instancias de recursos y módulos presentes en el plan.
- [ ] Distinguir valores conocidos, desconocidos y marcados como sensibles.
- [ ] Separar la vista de configuración del contenido de un plan importado.
- [ ] Mostrar origen y contexto disponible del plan; indicar vigencia no verificada cuando no pueda vincularse a los archivos actuales.
- [ ] Manejar planes incompletos, erróneos y versiones de formato no compatibles.
- [ ] Evitar registrar o exportar inadvertidamente valores sensibles; respetar las marcas disponibles.

**Terminado cuando:** las acciones, direcciones y valores desconocidos coinciden con planes de prueba reales, incluyendo ambos órdenes de reemplazo. Cambiar un archivo no altera ni actualiza ficticiamente un plan importado.

**Fuentes:** [Formato JSON de planes](https://developer.hashicorp.com/terraform/internals/json-format) y [datos sensibles](https://developer.hashicorp.com/terraform/language/manage-sensitive-data).

**Decisión de alcance:** importar planes completa la revisión visual en v1.0. La ejecución general de `init`, `validate`, `plan` o `apply` desde la interfaz sigue siendo V1. La excepción es la integración con Floci (V8): ejecuta `plan`, `apply` y `destroy` sobre una copia aislada, solo contra el emulador local, y muestra el plan sobre el diagrama. `ParsePlan` en `internal/floci` puede servir de base para importar planes.

## 7. Añadir análisis básicos verificables

**Funcionalidades**

- [ ] Catálogo inicial acotado de reglas de configuración, con identificador y documentación.
- [ ] Hallazgos con recurso, archivo, evidencia, severidad, explicación y recomendación.
- [ ] Resultados conforme, hallazgo, no aplicable e indeterminado; lo desconocido nunca equivale a aprobado.
- [ ] Filtros por regla, categoría y severidad; navegar al código.
- [ ] Exclusiones locales justificadas y visibles.
- [ ] Informe exportable que indique qué reglas se evaluaron y cuáles no pudieron evaluarse.
- [ ] Registrar reglas de forma que se puedan agregar sin cambiar el canvas; aplazar un lenguaje YAML genérico hasta tener necesidades verificadas.

**Primeras reglas candidatas:** subnet literal fuera del rango conocido de VPC; solapamiento de subnets conocidas; reglas de ingreso que permiten SSH desde rangos amplios; incumplimiento de tags exigidos por una política configurada por el usuario.

**Terminado cuando:** cada regla tiene casos positivos, negativos, no aplicables e indeterminados. Sus mensajes describen lo observado en la configuración y no afirman conectividad efectiva o seguridad global.

**Límite:** v1.0 entrega hallazgos y cobertura. El score de madurez y la etiqueta Production Ready no forman parte de esta entrega.

## 8. Enseñar el producto y facilitar su prueba

**Funcionalidades**

- [ ] Ayuda contextual opcional: qué representa el recurso y dónde se define.
- [ ] Tres ejemplos guiados (hay dos: `basic-vpc` y `web-app`): VPC con EC2; red con subnets públicas y privadas; aplicación web con balanceador y base de datos dentro de la cobertura disponible.
- [ ] Templates con variables de entrada, supuestos, instrucciones y versiones de proveedores compatibles.
- [ ] Previsualización de archivos y creación en un directorio nuevo; conflictos de nombres gestionados.
- [ ] Verificación sintáctica y validación Terraform en el proceso de publicación de templates; indicar requisitos pendientes y no afirmar despliegue probado sin evidencia.
- [ ] Landing con descarga, documentación, código fuente y Try Demo. Publicada en https://terradock.renzoaguilar.dev con código fuente, demo y una sección de descarga que apunta al último release de GitHub. Falta publicar el primer release (etiqueta `v*`) para que esos enlaces tengan archivos.
- [x] Demo con archivos de ejemplo en memoria, reinicio y las mismas restricciones de edición.
- [x] Validar cómo compartir el núcleo de análisis y edición en la demo, por ejemplo mediante una prueba de WebAssembly. No crear un segundo parser con comportamiento diferente.
- [x] Mantener la demo independiente de las carpetas del visitante y del servicio local.

**Terminado cuando:** un visitante comprende el intercambio código–gráfico usando la demo y puede repetir ese flujo con el producto instalado. La demo avanzada solo usa capacidades ya implementadas.

## 9. Publicar v1.0 estable

Esta etapa reúne la evidencia de calidad; sus controles se desarrollan desde las primeras fases.

**Entrega y calidad**

- [ ] Binarios versionados para los sistemas y arquitecturas oficialmente soportados, con verificación de integridad. Implementado: `make package` y el workflow Binarios generan los 6 archivos (macOS, Linux y Windows; ARM64 y AMD64) con `checksums.txt` al publicar una etiqueta `v*`. Falta publicar el primer release y verificarlo en cada sistema.
- [ ] Instalación, actualización, reversión y desinstalación documentadas.
- [ ] Arranque con una orden y apertura automática opcional del navegador; opción de abrir una ruta directamente. Hecho: arranque con una orden (`terradock`) y apertura del navegador desactivable con `--open=false`. Falta abrir un proyecto directamente al iniciar.
- [ ] Funcionamiento básico sin Terraform, credenciales AWS ni conexión a Internet después de instalar.
- [x] Frontend y recursos servidos localmente, sin dependencias externas necesarias para editar.
- [x] Servidor limitado a loopback; sesión y comprobación de origen/host para operaciones sensibles.
- [ ] Acceso a contenido y escritura delimitado al proyecto elegido; política explícita para enlaces simbólicos y módulos fuera de la raíz. La navegación para elegir un proyecto tiene un permiso separado y limitado.
- [ ] Exclusión del escaneo de `.git`, `.terraform` y archivos de estado; excepciones puntuales y de lectura para módulos instalados si se soportan.
- [ ] Diagnósticos útiles sin volcar contenidos o secretos de forma predeterminada.
- [ ] Navegación por teclado, foco visible, contraste y estados que no dependan solo del color.
- [ ] Documentación de compatibilidad, limitaciones, solución de problemas y recuperación.
- [ ] CI y regresiones de parser, escritor, sincronización, interfaz, planes y reglas. Existe CI con pruebas Go, unitarias, de navegador y de la portada, imágenes ARM64 con promoción automática y monitor del sitio; faltan las regresiones de planes importados.
- [ ] Pruebas en máquinas limpias y sesiones con usuarios distintos del autor.
- [ ] Objetivo propuesto: refresco del gráfico en menos de un segundo con proyectos de referencia de hasta 300 bloques de recursos; fijar máquina, navegador y medición p95. Verificar también apertura y navegación; registrar resultados reales. Medido en una MacBook ARM con Chromium: p95 de 50–159 ms con 300 recursos según el camino ([rendimiento](performance.md)). Faltan otras máquinas, la apertura y la navegación.
- [ ] Cero incidencias conocidas de pérdida de datos y cero bloqueos abiertos en los flujos de lanzamiento.

**Terminado cuando:** una persona instala la versión publicada, abre un proyecto compatible, completa los flujos principales, cierra y vuelve a abrir sin asistencia del autor. La evidencia de pruebas y la matriz de soporte acompañan la publicación.

## Lista de aceptación del 100 % de v1.0

- [ ] Puedo iniciar el programa y abrir una carpeta desde el navegador.
- [ ] Veo todos los archivos relevantes y una representación que declara su cobertura.
- [ ] Puedo navegar de código a recurso y de recurso a código.
- [ ] Puedo editar código y propiedades compatibles sobre los archivos originales.
- [ ] Se conservan comentarios, expresiones y contenido ajeno a la operación.
- [ ] Los cambios externos, borradores, conflictos y fallos se gestionan sin pérdidas silenciosas.
- [ ] Puedo recorrer variables y módulos dentro de la compatibilidad publicada.
- [ ] Puedo comprender las arquitecturas AWS objetivo y exportar su diagrama.
- [ ] Puedo comparar cambios de configuración e inspeccionar un plan JSON importado.
- [ ] Puedo consultar hallazgos con evidencia y reconocer lo que no se pudo evaluar.
- [ ] Puedo aprender con ejemplos y probar la demo antes de instalar.
- [ ] El producto funciona localmente y cumple sus pruebas de instalación, compatibilidad y rendimiento.

Estas casillas se marcan solo cuando el flujo completo cumple sus pruebas en la versión publicada. No se asignará un porcentaje de avance por número de pantallas: cada fase se cierra con sus pruebas y evidencia.

## Visión posterior: completar las capacidades avanzadas del texto original

| Etapa | Capacidades | Condición para considerarla terminada |
| --- | --- | --- |
| V1 — Operaciones Terraform | `validate`, `init` y `plan` iniciados por el usuario, con argumentos/contexto explícitos, progreso, cancelación, errores y tratamiento de credenciales. El ejecutor de Floci ya cubre progreso, cancelación, errores y aislamiento de credenciales para el emulador | Comandos y cancelación probados; abrir una carpeta no ejecuta Terraform; el usuario distingue procesamiento local de llamadas a proveedores |
| V2 — Construcción visual | Crear y eliminar recursos compatibles, editar referencias, listas y mapas simples; preview del diff y deshacer | Operaciones probadas sobre archivos reales, referencias revisadas y conflictos resueltos; arrastrar para ordenar sigue sin modificar infraestructura |
| V3 — Aprendizaje y patrones | Learn Mode ampliado, ejercicios y templates intermedios; serverless, Lambda/API Gateway, ECS y otros recursos según demanda | Cada ejemplo tiene objetivo, entradas, supuestos, validación y límites de despliegue publicados |
| V4 — Análisis extensible y madurez | Nuevas reglas de seguridad, fiabilidad e IaC; perfiles por tipo de sistema; plugins o formato declarativo | Metodología, aplicabilidad, cobertura y casos de prueba publicados; el score, si se incorpora, admite desconocidos y no certifica producción |
| V5 — Impacto y orden | Dependencias transitivas, impacto potencial y contraste con acciones del plan; orden conceptual de dependencias | Distingue relación estática de modificación planificada y de impacto en ejecución; no presenta un grafo reducido como secuencia exacta de Terraform |
| V6 — Networking | Evaluación estática de rutas y reglas compatibles; Trace Connection con supuestos y resultado permitido/bloqueado/indeterminado según el modelo | Un conjunto publicado de casos y limitaciones verifica el modelo; reglas de seguridad aisladas no se presentan como prueba de conectividad real |
| V7 — Git visual | Comparación con commits/ramas, cambios arquitectónicos y ayuda para revisión | Comparaciones reproducibles; Git no sustituye la gestión de borradores ni sobrescribe cambios locales |
| V8 — Floci y despliegue local (**en curso**) | Integración opcional, ejecución explícita en el entorno local y comparación con su estado. Hecho: iniciar Floci, plan, aplicar solo el plan revisado (se invalida si cambian los archivos), leer estado, destruir sin refresh, marcas por nodo (crear/actualizar/reemplazar/eliminar/en Floci), variables desde `tfvars` o el panel, copia aislada con overrides y sin credenciales reales. Pendiente: comparar atributos con el estado y avisar de servicios o tipos no emulados antes de aplicar | Se verifica contra el emulador real y se distinguen sus límites respecto a AWS; la integración no altera endpoints de proyectos silenciosamente |

La evaluación completa de IAM, estimación de costos, otros proveedores, colaboración, AI y asistencia avanzada de edición mediante un servidor de lenguaje quedan como líneas opcionales. No se necesitan para cerrar el producto Terraform/AWS definido aquí.

## Orden de trabajo inmediato

1. Hecho: la sincronización con 300 recursos queda por debajo de un segundo ([rendimiento](performance.md)). Falta repetir la medición en otras máquinas y sistemas.
2. Cerrar la fase 3: comparación de versiones en conflicto, recuperación de borradores tras cerrar o reiniciar, y archivos creados, renombrados o eliminados externamente.
3. Completar V8: detectar antes de aplicar los tipos y servicios que Floci no emula (por ejemplo `t3.large`) y comparar atributos con el estado desplegado.
4. Fase 4: variables, locals, outputs y módulos locales visibles en el diagrama.
5. Fase 9: publicar el primer release (etiqueta `v*`) de los binarios ARM64 y AMD64 para macOS, Linux y Windows, ya implementados con frontend incrustado y apertura del navegador (corren en la laptop de cada persona; la imagen del sitio sigue solo en ARM64). Después, firma de código, actualización y desinstalación documentadas.

No se asignan fechas antes de validar el núcleo técnico. Las estimaciones se harán con evidencia de esa prueba y la disponibilidad real de trabajo.

**Nota técnica sobre preservación:** `hclwrite` permite cambios específicos conservando comentarios y estructura, pero su serialización puede ajustar espacios. La garantía exacta de conservación debe establecerse mediante pruebas y la estrategia de escritura elegida. [Documentación HCL](https://pkg.go.dev/github.com/hashicorp/hcl/v2/hclwrite)
