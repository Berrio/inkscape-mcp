# ADR-001: Node 24, TypeScript, npm y ESM

## Estado

Aceptada el 2026-08-25.

## Contexto

El servidor necesita procesos hijos, acceso a archivos, TypeScript estricto y distribución por npm. El baseline local es Node 24.18.0 y npm 11.16.0.

## Decisión

- Usar Node `>=24.0.0 <25` y npm `>=11.0.0 <13`.
- Usar ESM y resolución `NodeNext`.
- Usar TypeScript `6.0.3` con `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, source maps y declaraciones.
- Usar lockfile npm y versiones exactas para dependencias directas.

## Consecuencias

TypeScript 7 no se usa todavía: `typescript-eslint` 8.68.0 declara compatibilidad hasta TypeScript 6.0.x. Se revisará la actualización cuando su rango oficial la soporte. No se emplean `--force` ni `--legacy-peer-deps` para ocultar conflictos.
