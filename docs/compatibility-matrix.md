# Matriz de compatibilidad — Windows/stdio 1.0

**Fecha de evidencia:** 2026-08-27  
**Baseline observado:** Inkscape `1.4.4 (dcaf3e7, 2026-05-05)`, instalación
MSIX en Windows, Node.js 24.x, npm 11.x, transporte MCP por stdio.

Esta matriz describe evidencia ejecutada, no una lista de extensiones que
Inkscape podría reconocer. Una capability anunciada por `--list-input-types`
no se convierte en una API MCP hasta que exista un adaptador, límites,
verificador y pruebas para ella.

## Cómo volver a comprobarla

Ejecuta:

```powershell
node .\dist\cli.js --doctor --json
npm run check
npm run test:mcp
npm run test:pack
```

El doctor informa versión, clase de instalación, opciones observadas, tipos de
entrada y sonda PNG sin revelar rutas. Las exportaciones que dependen de un
flag vuelven a comprobar su disponibilidad para la instalación local; no se
habilitan por esta tabla si el doctor discrepa.

El unico baseline verificado es Windows + Inkscape 1.4.4 MSIX. Se informa como
`support: "stable"` y `pageAdapter: "pages_v14"`. Tambien comprueba
`--export-type`, `--export-pdf-version`, `--export-plain-svg`,
`--export-text-to-path` y una `--action-list` disponible y no vacia; una
deriva queda como warning en vez de heredar compatibilidad solo por el texto de
version. Inkscape 1.5+ sigue experimental. Hasta tener un adapter
`pages_v15` contra una release real y fixtures de migracion, una
representacion de pagina SVG `view` se rechaza antes de leer o mutar paginas
para prevenir perdida silenciosa.

## Plataforma y transporte

| Área                              | Estado                      | Evidencia y límite                                                                                                                                                                          |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows + Inkscape 1.4.4 MSIX     | Estable para el baseline    | Discovery MSIX, doctor, stdio real y exports reales pasan en esta build. Las rutas MSIX no se fijan en configuración.                                                                       |
| Node.js 24 / npm 11               | Requerido                   | Declarado en `engines` y usado por build, tests y paquete aislado.                                                                                                                          |
| MCP stdio moderno `2026-07-28`    | Probado                     | `test:mcp` conecta y ejecuta flujos MCP representativos con cliente SDK.                                                                                                                    |
| MCP stdio legacy                  | Probado                     | El mismo smoke cubre negociación legacy explícita.                                                                                                                                          |
| HTTP                              | Experimental local (P2)     | `/mcp` en `127.0.0.1` con bearer rotatorio, principals, Host/Origin, límite de cuerpo/tiempo, rate limit y trazas redactadas. Aún no pasa conformance moderno ni se anuncia estable/remoto. |
| Inkscape 1.5+                     | Experimental/no anunciado   | No hay adapter `pages_v15`, fixtures de migración ni matriz multipágina aprobada.                                                                                                           |
| Linux y macOS                     | No anunciados como estables | El código puede compilar, pero no hay integración real de esta release para plataformas/versiones.                                                                                          |
| GUI bridge y extensiones GUI-only | No implementado             | El backend no depende de una ventana activa ni automatización por coordenadas.                                                                                                              |

## Importación

| Entrada                                        | Tool MCP                                  | Estado en 1.4.4    | Límites y fidelidad                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SVG                                            | `document_import` / `document_import_svg` | Probado            | Saneamiento, límites y publicación SVG + manifest; contenido activo y refs no permitidas se eliminan/rechazan según policy.                                                                                                                         |
| SVGZ                                           | `document_import`                         | Probado            | Exige gzip válido y límite de descompresión; no confía en la extensión.                                                                                                                                                                             |
| BMP/TIFF/TGA no comprimidos, PNG/JPEG/GIF/WebP | `document_import_raster`                  | Probado            | Sniffing de bytes, límites de tamaño/megapíxeles y wrapper SVG; BMP, TIFF y TGA se limitan a datos no comprimidos, GIF puede conservar una limitación de renderer y JPEG no aplica EXIF.                                                            |
| PDF, una página                                | `document_import_pdf`                     | Probado y gateado  | Importador interno o Poppler sólo con flags observados; publica warning de fidelidad/editabilidad, preflight de fuentes y perfiles del SVG resultante.                                                                                              |
| EPS y PostScript                               | `document_import_postscript`              | Probado y gateado  | Sonda controlada de conversión headless por instalación; exige firma `%!`, staging, revisión, dependencias y manifest. La fidelidad nativa no está garantizada.                                                                                     |
| AI/EMF/WMF/XAML/DXF y otros tipos del doctor   | Ninguno                                   | Bloqueado          | Que aparezcan como input type nativo no autoriza importarlos desde MCP; `document_import_capabilities` los mantiene bloqueados sin fixture headless. XAML además requiere fixtures reales de consumidor WPF y Avalonia antes de ser una salida MCP. |
| Fuentes/perfiles en SVG importado              | Manifest PDF/EPS/PS                       | Registrado/gateado | El manifest registra familias y perfiles del SVG resultante. `record` advierte sin prometer cobertura, embedding o conversión; las políticas estrictas rechazan fuentes ausentes o ICC sin declarar.                                                |

## Exportación

| Salida                                | Tool/preset                                                               | Estado en 1.4.4      | Verificación y limitación                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                                   | `export_png`, `document_export`, `web-png`, `web-asset-pack`, `icon-pack` | Probado              | Firma PNG, dimensiones, color, profundidad, bytes/hash y DPI si existe. Es raster: no conserva editabilidad vectorial.                                                                                                                                                                                        |
| PDF                                   | `export_pdf`, `export_pdf_pages`, `document_export`, presets PDF          | Probado              | PDF estructural, versión, páginas, MediaBox/CropBox, bytes/hash. Filtros y fuentes requieren inspección visual.                                                                                                                                                                                               |
| SVG de Inkscape                       | `export_svg` con `flavor: "inkscape"`                                     | Probado              | XML SVG y `viewBox` verificados; conserva features propias sólo para consumidores compatibles.                                                                                                                                                                                                                |
| SVG plano                             | `export_svg` con `flavor: "plain"`, `plain-svg`, `web-asset-pack`         | Probado              | XML SVG y `viewBox` verificados; puede perder información específica de Inkscape.                                                                                                                                                                                                                             |
| SVGZ                                  | Contrato interno, no tool pública especializada                           | No anunciado         | No se debe ofrecer como salida estable hasta tener tool, verificador y smoke.                                                                                                                                                                                                                                 |
| PS/EPS                                | `document_export`                                                         | Probado y gateado    | PS 2/3 y EPS pasan por staging/verificación; filtros, máscaras u opacidad se rechazan salvo aceptación explícita de rasterización con warning. EPS sólo permite drawing/selection.                                                                                                                            |
| EMF                                   | `document_export`, `document_import_emf`                                  | Probado y gateado    | Valida `ENHMETAHEADER`, restringe efectos con flatten explícito y exige SVG→EMF→SVG headless en su sonda de capability.                                                                                                                                                                                       |
| WMF                                   | `document_export`                                                         | Experimental/gateado | Valida cabecera WMF o Placeable WMF, requiere flatten explícito y devuelve siempre warning fuerte; no hay importador anunciado.                                                                                                                                                                               |
| DXF                                   | `document_export` (`inkscape-dxf/v1`)                                     | Experimental/gateado | Adaptador fijo y versionado, sin ID/parámetros de extensión aportados por cliente. Verifica DXF ASCII (`SECTION`/`EOF`) y exige `fidelityPolicy: "acknowledge-limited-fidelity"`; no promete fidelidad para estilos SVG complejos.                                                                            |
| HPGL                                  | `document_export` (`inkscape-hpgl/v1`)                                    | Experimental/gateado | Adaptador fijo y versionado, sin perfil o parámetros de plotter aportados por cliente. Verifica flujo ASCII con inicialización y comandos de pluma; exige `fidelityPolicy: "acknowledge-limited-fidelity"` y no promete fidelidad de estilos SVG ni compatibilidad con un plotter específico.                 |
| FXG                                   | `document_export` (`inkscape-fxg/v1`)                                     | Experimental/gateado | Adaptador fijo y versionado, sin ID ni opciones de extensión aportados por cliente. Verifica XML FXG no activo, raíz `Graphic`, versión y contenido vectorial; exige `fidelityPolicy: "acknowledge-limited-fidelity"` y no promete interoperabilidad moderna de Adobe/Flash.                                  |
| Synfig SIF                            | `document_export` (`inkscape-sif/v1`)                                     | Experimental/gateado | Adaptador fijo y versionado, sin ID ni opciones de extensión aportados por cliente. Verifica XML SIF no activo, raíz `canvas`, versión y capas; exige `fidelityPolicy: "acknowledge-limited-fidelity"`. El propio manifest declara pérdida de datos y no se promete compatibilidad con una versión de Synfig. |
| GIMP Palette (GPL)                    | Ninguno                                                                   | No anunciado         | El exportador INX instalado se ejecuta en una sonda SVG controlada, pero no publica un `.gpl` verificable. No se habilita por la presencia del manifest.                                                                                                                                                      |
| XAML                                  | Ninguno                                                                   | No implementado      | El servidor no lo anuncia sin verificador XML y fixtures de consumidores reales.                                                                                                                                                                                                                              |
| JPG/WebP/TIFF                         | Ninguno                                                                   | No anunciado         | La instalación contiene las extensiones, pero las sondas headless JPEG/TIFF/WebP no generaron artefacto verificable. No se anuncian por la mera presencia de un codec o input type.                                                                                                                           |
| PDF/X, CMYK profesional, separaciones | Ninguno                                                                   | No implementado      | No hay pipeline de preprensa certificado ni perfil de color externo.                                                                                                                                                                                                                                          |

## Flags y behavior de Inkscape 1.4.4 observados

| Capability                                                            | Estado                        | Uso MCP                                                                                                           |
| --------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PNG base: área, DPI, ancho/alto, fondo                                | Disponible                    | Usada por `export_png` y el pipeline común.                                                                       |
| PNG avanzado: antialias, color mode, compresión, dithering, snap area | Disponible por flag           | Cada opción se gatea antes de invocar Inkscape.                                                                   |
| PDF versión, texto a paths, ignore filters, LaTeX                     | Disponible por flag           | `export_pdf` comprueba capabilities y publica warnings/sidecar según la opción.                                   |
| `--export-filter-dpi`                                                 | No observado en este baseline | `filterDpi` y `print-pdf-300dpi` deben fallar recuperablemente si la instalación no lo anuncia.                   |
| PDF multipágina completo                                              | Probado                       | Sin `--export-page`, Inkscape produce un PDF multipágina.                                                         |
| PDF subset                                                            | Probado mediante staging      | El MCP poda una copia SVG temporal y declara `prune_subset`; no asume que `--export-page` construya un único PDF. |
| PDF por página                                                        | Probado mediante staging      | `export_pdf_pages` poda una variante por página y verifica un PDF por output.                                     |
| `--pages` y `--pdf-poppler`                                           | Disponibles                   | Gating de los modos PDF de importación.                                                                           |
| `--query-all`                                                         | Disponible                    | Bounds visuales nativos para fit/validación, declarados con fidelidad `partial`.                                  |

## Interpretación de estados

- **Probado** significa que existe evidencia de prueba real por stdio contra el
  baseline, además de límites y verificación del artefacto cuando aplica.
- **Gateado** significa que la operación sólo se habilita después de inspeccionar
  flags/capabilities de la instalación actual; una ausencia devuelve error
  recuperable.
- **No implementado** significa que no hay tool pública estable, aunque
  Inkscape anuncie una extensión o el código tenga tipos internos preparatorios.
- **Experimental/no anunciado** no debe usarse para una automatización de
  producción hasta completar adapter, fixtures y esta matriz con evidencia.

La matriz no modifica el límite de seguridad: todos los parsers nativos siguen
sin sandbox de SO y aceptan sólo entradas locales confiables. Consulta la
[guía de seguridad](./security-workspace-guide.md) antes de ampliar un
workspace o automatizar importaciones.
