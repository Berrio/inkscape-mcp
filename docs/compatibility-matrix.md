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

## Plataforma y transporte

| Área                              | Estado                      | Evidencia y límite                                                                                                    |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Windows + Inkscape 1.4.4 MSIX     | Estable para el baseline    | Discovery MSIX, doctor, stdio real y exports reales pasan en esta build. Las rutas MSIX no se fijan en configuración. |
| Node.js 24 / npm 11               | Requerido                   | Declarado en `engines` y usado por build, tests y paquete aislado.                                                    |
| MCP stdio moderno `2026-07-28`    | Probado                     | `test:mcp` conecta y ejecuta flujos MCP representativos con cliente SDK.                                              |
| MCP stdio legacy                  | Probado                     | El mismo smoke cubre negociación legacy explícita.                                                                    |
| HTTP                              | No implementado             | La CLI rechaza iniciar HTTP; no debe exponerse ni usarse como alternativa remota.                                     |
| Inkscape 1.5+                     | Experimental/no anunciado   | No hay adapter `pages_v15`, fixtures de migración ni matriz multipágina aprobada.                                     |
| Linux y macOS                     | No anunciados como estables | El código puede compilar, pero no hay integración real de esta release para plataformas/versiones.                    |
| GUI bridge y extensiones GUI-only | No implementado             | El backend no depende de una ventana activa ni automatización por coordenadas.                                        |

## Importación

| Entrada                                             | Tool MCP                                  | Estado en 1.4.4   | Límites y fidelidad                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| SVG                                                 | `document_import` / `document_import_svg` | Probado           | Saneamiento, límites y publicación SVG + manifest; contenido activo y refs no permitidas se eliminan/rechazan según policy.           |
| SVGZ                                                | `document_import`                         | Probado           | Exige gzip válido y límite de descompresión; no confía en la extensión.                                                               |
| PNG/JPEG/GIF/WebP                                   | `document_import_raster`                  | Probado           | Sniffing de bytes, límites de tamaño/megapíxeles y wrapper SVG; GIF puede conservar una limitación de renderer y JPEG no aplica EXIF. |
| PDF, una página                                     | `document_import_pdf`                     | Probado y gateado | Importador interno o Poppler sólo con flags observados; publica warning de fidelidad/editabilidad de glyphs.                          |
| AI/EPS/PS/EMF/WMF/XAML/DXF y otros tipos del doctor | Ninguno                                   | No implementado   | Que aparezcan como input type nativo no autoriza importarlos desde MCP.                                                               |
| Fuentes/perfiles incrustados                        | Ninguno                                   | No implementado   | Requiere política, licencias, manifests y fixtures específicos.                                                                       |

## Exportación

| Salida                                | Tool/preset                                                               | Estado en 1.4.4 | Verificación y limitación                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PNG                                   | `export_png`, `document_export`, `web-png`, `web-asset-pack`, `icon-pack` | Probado         | Firma PNG, dimensiones, color, profundidad, bytes/hash y DPI si existe. Es raster: no conserva editabilidad vectorial. |
| PDF                                   | `export_pdf`, `export_pdf_pages`, `document_export`, presets PDF          | Probado         | PDF estructural, versión, páginas, MediaBox/CropBox, bytes/hash. Filtros y fuentes requieren inspección visual.        |
| SVG de Inkscape                       | `export_svg` con `flavor: "inkscape"`                                     | Probado         | XML SVG y `viewBox` verificados; conserva features propias sólo para consumidores compatibles.                         |
| SVG plano                             | `export_svg` con `flavor: "plain"`, `plain-svg`, `web-asset-pack`         | Probado         | XML SVG y `viewBox` verificados; puede perder información específica de Inkscape.                                      |
| SVGZ                                  | Contrato interno, no tool pública especializada                           | No anunciado    | No se debe ofrecer como salida estable hasta tener tool, verificador y smoke.                                          |
| PS/EPS/EMF/WMF/XAML                   | Ninguno                                                                   | No implementado | Aunque el schema interno enumere formatos futuros, el servidor público no los anuncia.                                 |
| JPG/WebP/TIFF                         | Ninguno                                                                   | No implementado | No se anuncia por la mera presencia de un codec o input type.                                                          |
| PDF/X, CMYK profesional, separaciones | Ninguno                                                                   | No implementado | No hay pipeline de preprensa certificado ni perfil de color externo.                                                   |

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
