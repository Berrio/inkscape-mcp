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

## Actualización 2026-10-07

La auditoría de código de `contexto/auditorias/2026-10-07/` encontró nuevos
advisories publicados después de la revisión anterior:

- runtime: `@modelcontextprotocol/client` 2.0.0, GHSA-6qxp-vccf-f47h (alta;
  OAuth, no usado por el cliente stdio de la CLI);
- desarrollo: 11 advisories (1 crítico, 7 altos, 3 moderados) en el inspector
  2.3.0 y dependencias transitivas.

Con la autorización del mantenedor se actualizaron, fijados exactos,
`@modelcontextprotocol/{client,server}` 2.0.0 → **2.3.1** (y `core` 2.3.1) y
`@modelcontextprotocol/inspector` 2.3.0 → **2.9.0**. Las transitivas se
corrigieron con `npm audit fix` sin `--force`. Resultado: `npm audit --json` y
`npm audit --omit=dev --json` informan **0 vulnerabilidades**. `npm run check`
y las puertas E2E con Inkscape 1.4.4 se volvieron a ejecutar tras el cambio.

Posteriormente, con la aprobación del usuario (ADR-012), se añadió `koffi`
3.3.2 (MIT, exacta) como dependencia runtime para el Job Object de Windows.
Incluye binarios nativos precompilados. Su script de instalación
(`cnoke --prebuild`) queda bloqueado por la política `allow-scripts` de npm sin
que afecte a la carga, verificada en Windows x64. `npm audit` sigue en 0
vulnerabilidades.

## Licencias de runtime revisadas

| Paquete                                                                      |        Versión | Licencia declarada |
| ---------------------------------------------------------------------------- | -------------: | ------------------ |
| `@modelcontextprotocol/{client,core,server}`                                 |          2.3.1 | MIT                |
| `@xmldom/xmldom`                                                             |         0.9.12 | MIT                |
| `pdf-lib`, `@pdf-lib/{standard-fonts,upng}`                                  | 1.17.1 / 1.0.x | MIT                |
| `zod`                                                                        |          4.4.3 | MIT                |
| `koffi`                                                                      |          3.3.2 | MIT                |
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
