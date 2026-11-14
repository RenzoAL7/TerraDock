# Rendimiento de la sincronización

Objetivo: un cambio en archivo, código o inspector llega al diagrama en menos de
1 s con 300 recursos. Lo comprueba la prueba e2e
`con 300 recursos, archivo, código e inspector llegan al diagrama en menos de 1 s`.

## Colocación de muchos recursos a la vez (2026-11-14, MacBook ARM, Node 26)

`stabilize` en Node con el proyecto de las pruebas (`largeProject`), mediana
de siete llamadas. «Antes» es la búsqueda de hueco que comparaba cada celda
candidata con cada hermano; «después», la rejilla de cubos de `stable.ts`.
Las posiciones resultantes son las mismas en los dos casos.

| Caso                                                        | Antes        | Después      |
| ----------------------------------------------------------- | -----------: | -----------: |
| Sin cambios de estructura, 300 / 1000 recursos              | 0,2 / 0,7 ms | 0,5 / 0,6 ms |
| Un recurso nuevo, 300 / 1000                                | 0,3 / 0,7 ms | 0,3 / 0,6 ms |
| El proyecto crece de 300 a 500 (VPC nuevas con sus hijos)   |      12,7 ms |       0,7 ms |
| El proyecto crece de 1000 a 1500                            |       252 ms |       1,6 ms |
| 200 recursos sueltos nuevos entre 300 (la mitad con vecino) |        98 ms |         7 ms |
| 500 recursos sueltos nuevos entre 1000                      |      1975 ms |        50 ms |
| 300 recursos sustituidos por 500 de otro tipo               |       550 ms |       0,4 ms |
| 1000 recursos sustituidos por 1500 de otro tipo             |    15 246 ms |       1,3 ms |

Los dos primeros casos son los de la escritura normal: no buscan hueco o
buscan uno solo, y la diferencia está dentro del ruido de medir menos de 1 ms.
Los dos últimos ya no pasan por `stabilize` en el lienzo: una actualización
que trae sobre todo nodos nuevos se ordena de nuevo por capas
(`replacesDiagram`). La medición se hizo con una prueba temporal que no forma
parte del repositorio.

Con esos cambios (a213f10), la prueba e2e de latencia en Chromium, tres
corridas sin otras pruebas de navegador en marcha, da: archivo externo 58 ms
(58 · 56 · 61), inspector 239 ms (237 · 239 · 242) y código 152 ms
(152 · 152 · 146), como en la medición anterior.

## Medición tras «exportar» y «ordenar» (2026-11-13, MacBook ARM, Chromium)

Misma prueba e2e, tres corridas por versión (`--repeat-each=3`), sin otras
pruebas de navegador en marcha. Mediana y, entre paréntesis, las tres corridas.
La apertura es el tiempo desde pulsar «Abrir esta carpeta» hasta que el
explorador y el diagrama muestran los 300 recursos; se midió con una prueba
temporal que no forma parte del repositorio.

| Camino          | `main` (42c73bc)         | `feat/exportar-y-ordenar` |
| --------------- | -----------------------: | ------------------------: |
| Archivo externo |     54 ms (54 · 53 · 56) |      59 ms (59 · 63 · 58) |
| Inspector       | 238 ms (238 · 240 · 237) |  242 ms (241 · 250 · 242) |
| Código          | 149 ms (142 · 152 · 149) |  153 ms (153 · 158 · 152) |
| Apertura        | 128 ms (128 · 122 · 152) |  154 ms (160 · 154 · 140) |

La rama queda 4–5 ms por encima en los tres caminos. La causa no es el trabajo
por actualización, sino lo que se ve: la prueba centra el nodo con zoom 0,75 y
el orden por capas es más compacto que la cuadrícula, así que en pantalla hay
18 nodos y 6 aristas en vez de 8 y 2. Con ocho cambios seguidos del archivo
sobre la misma vista, la mediana es la misma en las dos versiones (70–72 ms).
En Node, `stabilize` tarda menos de 1 ms con 300 y con 1000 recursos cuando
la estructura no cambia o aparece un recurso, y no recalcula el orden (ver la
medición de 2026-11-14). La exportación sola (sin el orden por capas) no cambia
estos caminos: en otra serie de cuatro corridas quedó a 1–3 ms de `main`.

La apertura sube unos 25 ms: es la única vez, además de «Ordenar», que corre
el orden por capas (6,4 ms en Node con 300 recursos y 25 ms con 1000). El
resto de la diferencia no se aisló.

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
