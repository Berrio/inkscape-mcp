# Auditoría de dependencias

Esta auditoría se ejecutó el 2026-08-27 sobre el lockfile de `inkscape-mcp`
0.1.0 con npm 11.16.0 y Node 24.18.0.

## Resultado

- `npm audit --json`: 0 vulnerabilidades (`info`, `low`, `moderate`, `high` y
  `critical`) tanto en el grafo completo como con `--omit=dev`.
- `npm sbom --sbom-format=spdx --package-lock-only --json`: generó un SBOM
  SPDX 2.3 local con checksums de paquetes resueltos y relaciones de
  dependencia. El resultado debe regenerarse para cada release porque incluye
  identidad y fecha de creación.
- No se añadieron dependencias ni se ejecutaron actualizaciones como parte de
  esta revisión.

## Licencias de runtime revisadas

| Paquete                                                                      |        Versión | Licencia declarada |
| ---------------------------------------------------------------------------- | -------------: | ------------------ |
| `@modelcontextprotocol/{client,core,server}`                                 |          2.0.0 | MIT                |
| `@xmldom/xmldom`                                                             |         0.9.12 | MIT                |
| `pdf-lib`, `@pdf-lib/{standard-fonts,upng}`                                  | 1.17.1 / 1.0.x | MIT                |
| `zod`                                                                        |          4.4.3 | MIT                |
| `cross-spawn`, `eventsource`, `eventsource-parser`, `jose`, `pkce-challenge` |       lockfile | MIT                |
| `pako`                                                                       |         1.0.11 | MIT AND Zlib       |
| `tslib`                                                                      |         1.14.1 | 0BSD               |

Las licencias anteriores son permisivas y compatibles con la licencia MIT del
proyecto. El SBOM de release será el registro completo y autoritativo de las
dependencias transitivas, incluidas las de desarrollo y opcionales.

## Comandos reproducibles

```powershell
npm audit --json
npm audit --omit=dev --json
npm sbom --sbom-format=spdx --package-lock-only --json
npm ls --omit=dev --all
```

Una vulnerabilidad posterior debe tratarse como incidente de release: evaluar
alcance, fijar la actualización en el lockfile, repetir pruebas y regenerar el
SBOM antes de publicar.
