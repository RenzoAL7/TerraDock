# Rendimiento de la sincronización

Objetivo: un cambio en archivo, código o inspector llega al diagrama en menos de
1 s con 300 recursos. Lo comprueba la prueba e2e
`con 300 recursos, archivo, código e inspector llegan al diagrama en menos de 1 s`.

## Medición tras «crear desde el diagrama» (2026-11-13, MacBook ARM, Chromium)

Misma prueba e2e, tres corridas por versión (`--repeat-each=3`), sin otras
pruebas de navegador en marcha. Mediana y, entre paréntesis, las tres corridas.
La rama se midió dos veces: antes y después de `main`.

| Camino          | `main` (e50ca5b)         | `feat/crear-desde-diagrama`, 1.ª | 2.ª                      |
| --------------- | -----------------------: | -------------------------------: | -----------------------: |
| Archivo externo |     55 ms (53 · 56 · 55) |             54 ms (55 · 53 · 54) |     54 ms (54 · 53 · 55) |
| Inspector       | 230 ms (230 · 229 · 232) |         236 ms (228 · 237 · 236) | 230 ms (230 · 230 · 229) |
| Código          | 140 ms (140 · 139 · 151) |         146 ms (141 · 146 · 147) | 140 ms (140 · 149 · 138) |

La segunda medición de la rama coincide con `main`; la primera queda 6 ms por
encima en inspector y código, dentro de la variación entre corridas (139–151 ms
en el código de `main`). Crear un recurso no añade trabajo a esos caminos: la
inserción es una petición aparte, y el diagrama solo hace una comprobación
extra por nodo (si es nuevo) para colocar a la derecha los que aparecen.

## Medición (2026-11-13, MacBook ARM, Chromium)

Tiempo desde el cambio hasta que el nodo muestra el valor nuevo, con 300
recursos. Tres corridas de la prueba e2e por versión, sin otras pruebas de
navegador en marcha. Se indica la mediana y, entre paréntesis, las tres
corridas.

| Camino          | `main` (f8df7ba)         | `feat/producto-fiable`   |
| --------------- | -----------------------: | -----------------------: |
| Archivo externo |     54 ms (54 · 55 · 54) |     54 ms (53 · 54 · 56) |
| Inspector       | 228 ms (229 · 228 · 228) | 230 ms (230 · 230 · 230) |
| Código          | 136 ms (134 · 144 · 136) | 139 ms (139 · 134 · 140) |

Los tres caminos siguen muy por debajo de 1 s. El inspector tarda 2 ms más que
en `main` y el código 3 ms más, este dentro de la variación entre corridas. Una
medición anterior de la misma rama daba 9 ms más en el inspector; la mejora
coincide con quitar las explicaciones de solo lectura de la firma de cada nodo
(`nodeSignature` en `features/architecture/graph.ts`), aunque no se aisló.
Guardar borradores en IndexedDB no está en el camino de la sincronización: se
escribe con retardo y de forma asíncrona.

Las cifras de 2026-11-12 no son comparables con estas: se tomaron en otra
sesión y con otra carga del equipo.

## Medición (2026-11-12, MacBook ARM, Chromium)

Latencia p95 desde el cambio hasta que el nodo muestra el valor nuevo.

| Camino          | 300 antes | 1000 antes | 300 ahora | 1000 ahora |
| --------------- | --------: | ---------: | --------: | ---------: |
| Inspector       |    352 ms |     739 ms |    159 ms |     284 ms |
| Código          |    110 ms |     358 ms |     95 ms |     132 ms |
| Archivo externo |     67 ms |     214 ms |     50 ms |      84 ms |

El servidor analiza en 5–14 ms (`go test -bench Parse ./internal/terraform`:
3,6 ms con 300 recursos y 12,5 ms con 1000). La respuesta pesa 0,25 MB con 300
y 0,8 MB con 1000. El cuello de botella estaba en el navegador.

## Cambios que lo hicieron posible

- El diagrama reutiliza los nodos y aristas que no cambiaron (búsqueda por
  `Map`, antes O(n²)) y dibuja solo lo visible con más de 150 recursos.
- Tras editar en el inspector el análisis sale de inmediato y el retardo de
  aplicación bajó a 90 ms.
- El editor aplica cambios externos como una edición mínima
  (`features/editor/minimalEdit.ts`): conserva scroll, cursor y deshacer, y no
  vuelve a pintar el archivo entero.
- Seleccionar un recurso centra el nodo en el diagrama y la línea en el editor,
  aunque ya estuviera seleccionado.

## Repetir la medición

```sh
TERRADOCK_DUMP=/tmp/p300 TERRADOCK_DUMP_N=300 go test -run TestDumpLargeProject ./internal/terraform
go run ./cmd/terradock --root /tmp/p300
```
