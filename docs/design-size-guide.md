# Tamaños, `viewBox`, DPI, áreas y páginas

Esta guía explica cómo conservar el tamaño correcto de un diseño al crearlo,
redimensionarlo y exportarlo desde Inkscape MCP. Está pensada para etiquetas,
material impreso, piezas web y documentos con varias páginas.

## El modelo que evita los recortes

Un SVG tiene dos medidas que no son equivalentes:

- `width` y `height` describen el tamaño físico del lienzo, por ejemplo
  `100mm × 40mm`.
- `viewBox` describe qué coordenadas de dibujo caben dentro de ese lienzo.

El servidor usa 96 CSS px por pulgada para convertir unidades físicas. Por
ello, cambiar milímetros no implica por sí solo escalar los objetos: depende
del modo de `document_resize`. Una imagen PNG sí tiene píxeles; su DPI conecta
la dimensión de píxeles con el tamaño físico de impresión.

La regla práctica es sencilla: para imprenta define primero el tamaño físico;
para pantalla define primero los píxeles finales; antes de exportar, inspecciona
el documento y usa su `revision` vigente. No reutilices una revisión tras una
mutación.

## Crear un documento con la medida final

`document_create` recibe un preset o los tres valores `width`, `height` y
`unit`, nunca ambas variantes. Las unidades permitidas son `mm`, `cm`, `in`,
`pt`, `pc`, `q` y `px`. Los presets actuales son `a3-landscape`,
`a3-portrait`, `a4-landscape`, `a4-portrait`, `letter-landscape` y
`letter-portrait`.

Para una etiqueta de 10 cm × 4 cm, crea el documento así (sustituye
`workspaceId` por el devuelto por `workspace_list`):

```json
{
  "workspaceId": "ws_...",
  "outputPath": "etiquetas/nueva-etiqueta.svg",
  "width": 10,
  "height": 4,
  "unit": "cm"
}
```

Después llama `document_inspect` y conserva la `revision` que devuelve. Es el
control de concurrencia necesario para cualquier cambio o exportación
posterior.

## Redimensionar sin deformar el diseño

Usa siempre primero `document_resize` con `dryRun: true`. El resultado expone
el tamaño, `viewBox`, diff, matriz si la hubiera y warnings previstos; sólo
repite con `dryRun: false` cuando ese resultado sea correcto.

La mutación publicada también devuelve el mismo diff semántico acotado, la
nueva `revision` y `backupCreated`; si la revisión ya no coincide, falla sin
publicar una modificación parcial.

| Modo                    | Qué cambia                                                         | Cuándo usarlo                                                      |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `page_only`             | El lienzo y un `viewBox` proporcional; no transforma objetos.      | Cambiar el formato o eliminar/añadir espacio alrededor del diseño. |
| `scale_content_contain` | Lienzo y contenido con escala uniforme. Puede dejar espacio libre. | Encajar el diseño entero sin recortarlo.                           |
| `scale_content_cover`   | Lienzo y contenido con escala uniforme. Puede recortar extremos.   | Llenar completamente un formato de destino.                        |
| `scale_content_stretch` | Lienzo y contenido con escala distinta por eje.                    | Sólo cuando la deformación es intencional.                         |

El `anchor` controla desde qué punto se mantiene el encaje:
`top_left`, `top_center`, `top_right`, `center_left`, `center`,
`center_right`, `bottom_left`, `bottom_center` o `bottom_right`.

Para convertir una etiqueta existente a 10 cm × 4 cm sin escalar su arte,
envía `mode: "page_only"`, `anchor: "center"`, `unit: "cm"`, `width: 10`
y `height: 4`. Si parte del diseño queda fuera del nuevo lienzo, eso es
esperable: el arte no se ha reducido. Usa `contain` si lo que necesitas es que
todo el arte visible se reduzca para caber.

## Ajustar el lienzo al contenido

`document_fit_page` calcula bounds visuales nativos de Inkscape para el
dibujo completo (`scope: "drawing"`) o para una selección concreta
(`scope: "selection"` e `ids`). Acepta márgenes independientes `top`,
`right`, `bottom` y `left` en la unidad indicada y no transforma objetos.

Es la herramienta adecuada para quitar espacio blanco no deseado arriba y
abajo de una etiqueta. El resultado declara `boundsFidelity: "partial"`:
los bounds son la observación visual de Inkscape, no una promesa de layout CSS
perfecto. Revisa los warnings si hay filtros, trazos complejos, marcadores o
CSS avanzado.

No confundas este margen con bleed de impresión. El margen separa el contenido
del borde del lienzo; el bleed se revisa en `document_preflight` y se maneja
explícitamente al exportar PDF cuando corresponde.

## DPI y píxeles de PNG

El DPI no altera los vectores SVG ni PDF. Al exportar PNG, `export_png` ofrece
dos contratos alternativos:

- `dpi`: Inkscape deriva las dimensiones de píxeles a partir del tamaño físico
  del área elegida. Úsalo, por ejemplo, para una etiqueta a 300 DPI.
- `width` o `height`: fija una dimensión de píxeles y conserva proporción. Si
  fijas ambas, debes declarar `allowDistortion: true`; de lo contrario se
  rechaza para evitar deformación accidental.

No se puede mezclar `dpi` con `width` o `height` en la misma exportación. Como
referencia para planificar un raster: `píxeles = milímetros / 25.4 × DPI`.
Una pieza de 100 × 40 mm a 300 DPI requiere aproximadamente 1181 × 472 px.
El resultado de `export_png` confirma ancho, alto y DPI leídos del PNG; úsalo
como comprobación, no sólo como intención.

## Elegir con precisión el área PNG

`export_png` usa `area: "page"` por defecto. También acepta:

- `drawing`: incluye los límites visuales del dibujo; es útil si el lienzo no
  debe aparecer.
- `page`: exporta el lienzo completo; en un documento multipágina se puede
  indicar `pageId`.
- `selection`: exporta un único elemento, identificado por `selectionId`.
- `custom`: exporta el rectángulo de coordenadas de usuario
  `customArea: { x, y, width, height }`.

`customArea` sólo es válido con `custom`, `selectionId` sólo con `selection` y
`pageId` sólo con `page`. Para un PNG transparente, usa
`background: "transparent"`; para un color sólido, usa `background: "solid"`
y `backgroundColor: "#RRGGBB"` (con `backgroundOpacity` opcional).

Una exportación debe contener `expectedRevision` de la fuente y una ruta PNG
relativa nueva en `outputPath`. Si quieres reemplazar un output ya existente,
obtén antes su hash y envíalo como `expectedOutputRevision`; el servidor no
sobrescribe a ciegas.

## Documentos con varias páginas

`document_pages` lista y modifica páginas explícitas de Inkscape. Trata su
`id` como opaco y estable: no derives el ID a partir del número visual ni lo
reutilices después de borrar o reordenar páginas. `document_page_validate`
ayuda a detectar solapamientos, páginas vacías y objetos fuera de ellas.

Hay dos resultados PDF distintos:

- `export_pdf` crea un único PDF. Sin `pageIds`, exporta el documento completo;
  con `pageIds`, crea un único PDF que conserva sólo las páginas solicitadas,
  en el orden dado. El resultado confirma `pageCount`, `mediaBoxes` y
  `cropBoxes`.
- `export_pdf_pages` crea un PDF por cada página explícita, en
  `outputDirectory/page-001.pdf`, `page-002.pdf`, etc. Si omites `pageIds`,
  exporta todas las páginas explícitas. Cada archivo se verifica como PDF de
  una sola página antes de publicarse.

Para un PNG de una página concreta, primero lista las páginas y pasa ese
`pageId` a `export_png` con `area: "page"`.

## Flujo seguro recomendado

1. `workspace_list` y `document_inspect`: toma `workspaceId` y `revision`.
2. Si cambia el tamaño, ejecuta `document_resize` con `dryRun: true` y revisa
   el `viewBox`, la matriz y los warnings.
3. Si el problema es espacio blanco, usa `document_fit_page` con márgenes
   explícitos, no escalado de contenido.
4. Ejecuta `document_preflight` con perfil `print`, `web` o `interchange`.
5. Exporta PNG con un área y DPI/dimensión de píxeles explícitos; exporta PDF o
   SVG con sus tools especializadas.
6. Lee las dimensiones, hashes y warnings devueltos. Si el archivo cambió
   mientras se preparaba, vuelve a inspeccionarlo en vez de forzar la revisión.

Para entregas repetibles sin modelo, usa los presets de `inkscape-mcp export`
o una receta `inkscape-mcp-recipe/v1`. Ambos reutilizan este mismo flujo MCP,
incluida la revisión, el preflight y la publicación atómica.
