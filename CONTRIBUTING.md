# Contribuir a TerraDock

La demo debe conservar una relación comprobable entre el Terraform original y su representación. Prioriza cambios pequeños que se puedan probar sobre archivos y acciones reales.

## Ramas y revisión

- `main`: integración estable; cada cambio llega mediante un pull request.
- `codex/<tema>`: funcionalidades, correcciones y documentación trabajadas con Codex. Usa un nombre que describa el cambio, por ejemplo `codex/parser-modules`.
- Las ramas duran lo que dura el cambio. No mantenemos una rama `develop` adicional.
- Actualiza la rama, ejecuta las comprobaciones y prepara commits enfocados. No incluyas dependencias instaladas, archivos de estado Terraform ni resultados de pruebas.
- La revisión debe describir el problema, el comportamiento final, las pruebas ejecutadas y los límites relevantes.

La protección de `main` se configura en GitHub; documentar esta política no activa una regla remota. Antes de aceptar colaboraciones, el mantenedor debería exigir CI y resolución de conversaciones. El requisito de otro aprobador depende de cuántos mantenedores participen.

## Preparar el entorno

Sigue el [inicio rápido](README.md#probar-la-demo) y la [guía de desarrollo](docs/development.md). Instala dependencias con `npm ci`; conserva `web/package-lock.json` y `go.sum` al modificar dependencias.

## Validar un cambio

```sh
make check
make test
make build
make e2e
git diff --check
```

Instala Chromium con `make e2e-install` antes de la primera ejecución. Los cambios puramente documentales requieren revisar enlaces, instrucciones y formato; no requieren añadir pruebas que dupliquen el texto.

Para nuevas capacidades de Terraform, añade un caso que demuestre la lectura o edición y otro que compruebe un límite o fallo. Una expresión no soportada debe permanecer visible. Una prueba de parser no demuestra que AWS acepte una configuración.

## Contratos de producto

- Mantén el procesamiento local del proyecto y declara cualquier nueva necesidad de red.
- No ejecutes Terraform al abrir una carpeta.
- Conserva las referencias a archivo, rango y expresión original.
- Rechaza cambios que ya no corresponden a la revisión leída por el usuario.
- Añade capacidades a la [matriz de compatibilidad](docs/limitations.md) solo cuando estén implementadas y verificadas.
- Usa texto concreto en español en la interfaz y evita presentar un gráfico de configuración como infraestructura real.

## Reportar errores

Incluye el sistema operativo, la versión de Go/Node si compilas, pasos reproducibles y el resultado esperado. Adjunta un ejemplo mínimo con nombres e identificadores ficticios. No incluyas credenciales, estados Terraform ni archivos privados completos.
