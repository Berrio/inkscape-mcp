# ADR-007: Manifest de fixtures y regresión visual

## Estado

Aceptada el 2026-08-25.

## Decisión

Cada fixture se registra en `tests/fixtures/manifest.json` y valida contra `schemas/fixture-manifest.schema.json`.

El manifest exige:

- ID y archivo fuente únicos.
- Origen, licencia y versión del fixture.
- Rango de versiones/plataformas/capabilities aplicables.
- Assertions estructurales, numéricas y visuales separadas.
- Para cada assertion visual: renderer, golden, background, dimensiones y tolerancia concreta por fixture.

No existe una tolerancia visual global. Todo cambio de golden requiere una razón revisada y una aprobación explícita en el manifest.

## Consecuencias

Las regresiones visuales complementan, pero no sustituyen, verificaciones XML/PDF/PNG y contratos numéricos. Los archivos binarios con licencia incierta no entran al repositorio.
