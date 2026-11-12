# Rendimiento de la sincronización

Objetivo: un cambio en archivo, código o inspector llega al diagrama en menos de
1 s con 300 recursos. Lo comprueba la prueba e2e
`con 300 recursos, archivo, código e inspector llegan al diagrama en menos de 1 s`.

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
