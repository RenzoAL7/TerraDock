# Evidencia de la demo 0.1.0

Verificación local completada el 11 de septiembre de 2026 en macOS con Go 1.27.1, Node.js 26.5.0 y Chromium de Playwright. CI está configurado para Go según `go.mod` y Node.js 24; todavía debe ejecutarse en GitHub después de publicar la rama.

| Comprobación | Resultado |
| --- | --- |
| `make check` | Formato, ESLint, TypeScript y `go vet` correctos |
| `make test` | Suites Go con detector de carreras y 22 pruebas de lógica del frontend correctas |
| `make build` | Frontend y ejecutable compilados |
| `make e2e` | 9 escenarios Chromium correctos sobre el servidor Go y sus assets de producción |
| `npm --prefix web audit --audit-level=moderate` | Sin vulnerabilidades reportadas en la consulta realizada |
| `git diff --check` | Sin errores de espacios |

## Flujos verificados en el navegador

1. Arquitectura y Monaco cargan desde el servidor local, bloqueando peticiones a otros orígenes.
2. Vista estrecha de 390 × 844 y apertura/cierre de ayuda.
3. Editar una propiedad actualiza diagrama y código, conservando el resto del archivo.
4. Pegar y guardar código actualiza propiedades y arquitectura.
5. Cambiar entre los ejemplos produce su conjunto correspondiente de recursos.
6. Guardar HCL inválido conserva el último gráfico válido y muestra diagnósticos.
7. Abrir una carpeta temporal, escribir una propiedad y observar un cambio externo.
8. Una revisión obsoleta recibe 409; se conserva tanto el borrador como el archivo externo.
9. Continuar escribiendo mientras se retrasa la respuesta de un guardado conserva el nuevo borrador y permite guardarlo después.

Las pruebas de parser, almacenamiento y API cubren también rangos de edición, comentarios, UTF-8, precisión numérica, expresiones, límites de tamaño, rutas fuera de la raíz, symlinks, identidad de proyecto y orden de actualizaciones. El fuzzing acotado del parser/editor completó 98 912 entradas sin fallos durante su ejecución de diez segundos.

Se inspeccionaron visualmente las capturas de [arquitectura](screenshots/workspace.png) y [editor](screenshots/editor.png). Los reportes completos de Playwright se regeneran con `make e2e` y permanecen fuera de Git.

## Alcance de esta evidencia

No se ejecutó Terraform ni se desplegó infraestructura. Esta validación no acredita compatibilidad completa con proveedores, funcionamiento de escritorio en todos los sistemas, accesibilidad certificada o rendimiento con proyectos grandes. El aviso de tamaño del chunk de Monaco sigue presente en el build: se carga bajo demanda al entrar al editor y se sirve localmente. Los límites del producto están en [limitations.md](limitations.md).
