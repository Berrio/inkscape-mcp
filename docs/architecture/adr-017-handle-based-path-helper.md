# ADR-017: helper de rutas basado en handles frente a carreras de reparse points (evaluación)

## Estado

Evaluación cerrada el 2026-10-07 (F12-T10). Técnicamente viable; **no se implementa en 1.0** porque el modelo de amenaza vigente (ADR-008) exige roots privados y no incluye un atacante local concurrente.

## Contexto

El resolver actual canonicaliza con `realpath`, comprueba la contención y vuelve a validar el padre justo antes del `rename`. Entre la comprobación y el uso queda una ventana (TOCTOU): un proceso local con permisos de escritura en el workspace podría cambiar un directorio por una junction. `nativeSecurityPosture` ya lo declara como riesgo residual.

## Prueba de viabilidad

Con `koffi` (ADR-012) se llamó a la API Win32 sobre un workspace que contenía una junction hacia un directorio externo:

| Apertura                                             | Resultado                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Directorio normal, `FILE_FLAG_OPEN_REPARSE_POINT`    | ruta final dentro del workspace, `isReparsePoint: false`                |
| Junction, `FILE_FLAG_OPEN_REPARSE_POINT` (no seguir) | el handle es la propia junction, `isReparsePoint: true`                 |
| Junction, siguiéndola                                | `GetFinalPathNameByHandleW` devuelve el destino **fuera** del workspace |

Por tanto, desde un handle se puede detectar el reparse point y conocer el destino real **del objeto ya abierto**, en lugar de una ruta que puede cambiar.

## Diseño propuesto si se exige

1. Abrir el root una vez al arrancar y conservar su handle.
2. Recorrer cada segmento con `NtCreateFile`, usando como `RootDirectory` el handle del segmento anterior y `FILE_FLAG_OPEN_REPARSE_POINT`. Cualquier reparse point se rechaza en lugar de seguirse.
3. Crear el temporal y publicar con operaciones relativas al handle del directorio padre (`FILE_RENAME_INFORMATION` con `RootDirectory`), de modo que la comprobación y el uso recaigan sobre el mismo objeto.
4. Antes de publicar, verificar el resultado con `GetFinalPathNameByHandleW`.

Coste estimado:

- reescribir `WorkspaceService` y `AtomicFileStore` sobre handles;
- `ntdll` vía FFI;
- tests de carrera deterministas con un hilo que alterne junctions.

## Decisión

No se implementa ahora. Es la ruta recomendada si un despliegue necesita **workspaces compartidos con escritores no confiables**. Hasta entonces, la mitigación documentada sigue siendo que los roots sean directorios privados del usuario que ejecuta el servidor.
