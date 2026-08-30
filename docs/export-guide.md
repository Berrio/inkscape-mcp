# Exportar PNG, PDF y SVG con resultados verificables

Esta guía elige el formato correcto, explica las pérdidas previsibles y muestra
qué comprueba Inkscape MCP antes de publicar un archivo. Parte de
[la guía de tamaños](./design-size-guide.md): define primero la página y el
área; después decide el formato.

## Regla antes de cualquier exportación

1. Ejecuta `document_inspect` y conserva la `revision`.
2. Ejecuta `document_preflight` con el perfil de destino: `print`, `web` o
   `interchange`.
3. Envía esa revisión como `expectedRevision` y una ruta relativa de salida
   nueva. Para reemplazar un archivo existente, proporciona también su hash
   actual en `expectedOutputRevision`.
4. Lee el resultado devuelto: no basta con que Inkscape termine sin error.

La exportación usa una copia inmutable y validada del SVG dentro de staging; el
archivo fuente no se entrega directamente al proceso nativo. La publicación
ocurre sólo después de verificar el artefacto y comprobar que la revisión de
origen no cambió.

## PNG: raster para web, vista previa o imprenta controlada

PNG captura una apariencia en píxeles. Conserva transparencia, pero **no**
conserva la editabilidad vectorial, capas, texto ni objetos SVG. Elige PNG para
una imagen web, una vista previa, un icono o una entrega de imprenta cuyo
tamaño de píxeles ya esté acordado.

Usa `export_png` cuando necesites controlar área, fondo, DPI, píxeles,
compresión, antialias, color o snapping. El resultado verifica firma PNG,
anchura, altura, tipo de color, profundidad, bytes, hash y, cuando está
presente, DPI por eje.

| Necesidad                           | Configuración recomendada                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Imagen web transparente             | `area: "drawing"`, `background: "transparent"`, `width` o `height` en píxeles. |
| Etiqueta para rasterizar a imprenta | `area: "page"`, `dpi: 300` y fondo explícito si no debe conservar alfa.        |
| Recorte exacto                      | `area: "custom"` con `customArea` en coordenadas del documento.                |
| Elemento individual                 | `area: "selection"` con un `selectionId` existente.                            |
| Página concreta multipágina         | `area: "page"` y su `pageId` opaco.                                            |

No combines `dpi` con `width` ni `height`. Si estableces los dos ejes de
píxeles, `allowDistortion: true` es obligatorio porque podría deformar el
arte. La guía de tamaños explica el cálculo físico y las áreas en detalle.

## PDF: entrega de impresión y documento multipágina

PDF conserva vectores cuando Inkscape puede representarlos como tales, pero no
es una promesa de que cada feature SVG se mantenga editable ni idéntica en
todos los visores. Filtros SVG pueden rasterizarse o variar; `foreignObject`,
fuentes no disponibles y características específicas de Inkscape requieren
revisión visual. El perfil `print` señala estas condiciones antes de exportar.

Usa `export_pdf` para opciones específicas de PDF:

- `textToPath: true` convierte texto a contornos. Evita una dependencia de
  fuentes, pero pierde selección, búsqueda, copia y edición como texto. El
  resultado avisa `TEXT_CONVERTED_TO_PATHS`.
- `filters: "ignore"` omite filtros para priorizar compatibilidad y avisa
  `FILTERS_IGNORED_VISUAL_CHANGE`; no lo uses sin comparar el PDF resultante.
- `filterDpi` controla la rasterización de filtros, pero sólo se acepta si
  `--doctor`/las capabilities de la instalación anuncian ese flag. Si no está
  disponible, el servidor falla de forma recuperable: no simula 300 DPI.
- `margin` expande temporalmente la página del artefacto y avisa
  `PDF_MARGIN_EXPANDED_TEMPORARY`; no modifica el SVG fuente.
- `pageIds` produce un solo PDF que contiene exclusivamente esas páginas,
  mediante una copia temporal podada. El resultado declara
  `strategy: "prune_subset"` y `PDF_SUBSET_PRUNED`.
- `latex: true` publica el PDF junto con su sidecar `.pdf_tex` en un lote
  lógico; conserva ambos archivos si vas a usar LaTeX.

El resultado valida cabecera y estructura del PDF, versión, número de páginas,
`MediaBox`, `CropBox`, tamaño, hash y warnings. Revisa que los boxes tengan
el tamaño físico esperado y que `pageCount` coincida con la entrega.

Para un archivo PDF por página explícita de Inkscape, usa
`export_pdf_pages`. Publica `page-001.pdf`, `page-002.pdf`, etc., cada uno
verificado como PDF de una sola página. No deduzcas los IDs: obténlos con
`document_pages`.

No se anuncia PDF/X, separación profesional CMYK ni preprensa certificada. Son
trabajo P2/P3 que exige un pipeline especializado y fixtures propios.

## SVG: vector editable e intercambio

`export_svg` crea SVG de Inkscape o SVG plano:

| Flavor                                  | Úsalo cuando                               | Pérdidas y comprobación                                                                                                |
| --------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `inkscape`                              | El archivo seguirá editándose en Inkscape. | Conserva información específica en la medida en que Inkscape la exporta; otros renderizadores pueden no interpretarla. |
| `plain`                                 | El destinatario necesita SVG más portátil. | Inkscape elimina/convierte información propia; prueba el archivo en el renderer final.                                 |
| Cualquier flavor con `textToPath: true` | Debes evitar dependencia de fuentes.       | El texto deja de ser texto editable y accesible como tal.                                                              |

El SVG publicado se vuelve a validar como XML SVG y el resultado incluye
`viewBox`, hash, tamaño y warnings. Una exportación de selección puede generar
un directorio de assets junto al SVG cuando éste necesita recursos locales
extraídos; conserva el SVG y ese directorio como una unidad.

Los recursos locales se preservan bajo una política explícita. Recursos remotos
o contenido activo se rechazan antes de invocar Inkscape. Para intercambio,
ejecuta `document_preflight` con `interchange`: sus warnings sobre
características Inkscape, flow text, LPE, fuentes, referencias y SVG avanzado
son una lista de pruebas necesarias, no una conversión garantizada.

## Presets autónomos

La CLI `inkscape-mcp export` y las recetas
`inkscape-mcp-recipe/v1` usan los mismos lotes y verificadores que las tools.
Los presets actuales son deterministas:

| Preset             | Archivos publicados                                 | Uso y límite relevante                                                    |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------- |
| `print-a4-pdf`     | `print-a4.pdf`                                      | PDF del documento completo; el nombre no redimensiona el SVG a A4.        |
| `print-pdf-300dpi` | `print-300dpi.pdf`                                  | Solicita rasterización de filtros a 300 DPI; depende de capability.       |
| `web-png`          | `web-1200.png`                                      | Dibujo, transparente, 1200 px de ancho.                                   |
| `web-asset-pack`   | `web.svg`, `web-1x.png`, `web-2x.png`, `web-3x.png` | SVG plano del documento y PNG transparentes del dibujo.                   |
| `plain-svg`        | `plain.svg`                                         | SVG plano, texto preservado y recursos locales preservados.               |
| `icon-pack`        | PNG de 16 a 512 px                                  | PNG cuadrados; se permite deformación para garantizar cada tamaño exacto. |

Los presets de exportación usan `inkscape-mcp-export-preset/v1`. Sólo sus
overrides tipados se aceptan: los presets de impresión permiten `text:
"preserve"|"paths"`; los sociales permiten una pareja completa `widthPx` /
`heightPx` y requieren `metadata.createdAt` (ISO con zona) y
`metadata.sourceLabel`. Esa metadata aparece en el plan y en el manifest del
lote, no se inserta en el SVG fuente. Las definiciones locales reutilizables
usan `inkscape-mcp-export-preset-definition/v1`; su herencia es determinista y
rechaza padres desconocidos y ciclos.

Antes de ejecutar una exportación autónoma, usa `--dry-run`. La salida JSON
muestra digest, vencimiento y archivos planeados sin crear outputs. En una
receta, añade primero una operación `preflight`; la ejecución valida todas
las rutas y colisiones de outputs antes de publicar el primer lote.

## Qué conservar junto al archivo final

Guarda el SVG fuente, la receta o comando usado, el recibo JSON y el resultado
de preflight. Para PDF, guarda también el sidecar cuando se pidió LaTeX. Para
SVG de selección, guarda su directorio de assets. Estos elementos permiten
reproducir la entrega cuando ya no haya una sesión de IA disponible.

Si el resultado contiene warnings de fuente, filtros, recursos externos,
compatibilidad o cambios visuales, trata la entrega como pendiente de
inspección humana: una validación estructural prueba que el archivo existe y
tiene la forma esperada, no que una composición compleja sea idéntica en todos
los motores.
