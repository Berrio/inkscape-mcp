# ADR-005: Revisiones, locks, temporales y commits de archivos

## Estado

Aceptada el 2026-08-25.

## Decisión

- Las revisiones son hashes SHA-256 de streaming.
- Toda mutación exige `expectedRevision`; overwrite de outputs exige `expectedOutputRevision`.
- Se usan locks por ruta canónica, staging propio y backup antes de una edición in-place.
- Un output individual se valida antes de un rename/replace compatible con Windows.
- Un lote solo se considera atómico por filesystem cuando publica un directorio mediante un único rename; en otros casos se usa un commit marker/manifest y rollback best-effort documentado.

## Consecuencias

El servidor no presentará una secuencia de múltiples renames como una transacción crash-atómica. F02 y F05 deben probar conflicto, cancelación, crash y limpieza de staging.
