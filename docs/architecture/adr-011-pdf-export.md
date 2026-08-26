# ADR-011: Exportación e inspección PDF

## Decisión

Usamos `pdf-lib` 1.17.1 (MIT, dependencia directa fijada) como inspector
estructural de PDF. El verificador exige cabecera PDF legible y documento
parseable, y devuelve versión, número y orden de páginas, MediaBox, CropBox,
longitud y SHA-256. No se usa para interpretar apariencia ni para reescribir
PDFs exportados por Inkscape.

En Inkscape 1.4.4, la sonda controlada sobre `pdf-multipage.svg` confirmó:

- sin `--export-page`, la exportación produce un solo PDF multipágina;
- con `--export-page=all`, el nombre de salida solicitado no se crea y el
  motor produce archivos individuales con sufijo `_pN.pdf`;
- por ello `--export-page` no se usa para construir un único PDF subset.

El camino baseline para un subset es podar las páginas no solicitadas de una
copia SVG inmutable y exportar esa copia sin `--export-page`. Un camino directo
solo podrá habilitarse tras una sonda que pruebe que una versión futura genera
un único PDF con el orden y boxes solicitados. Un merge externo es último
recurso, requiere adaptador/fixture propios y no se anuncia ahora.

## Tolerancias y viewBox no cero

Las cajas se comparan por cada componente con una tolerancia de 0.6 pt. La
sonda 1.4.4 devolvió tanto cajas exactas de 100 mm (283.464567 pt) como cajas
redondeadas a 284 pt para el mismo tamaño físico; la tolerancia cubre ese
redondeo sin ocultar una diferencia material. `pdf-nonzero-viewbox.svg` exportó
un MediaBox y CropBox de 284 × 142 pt y la rasterización conservó el rectángulo
completo. Por tanto esta build no activa normalización temporal del origen de
`viewBox`; una sonda futura que reproduzca el problema 6323 deberá activarla y
declararla en el manifest.

## Capacidades

Las opciones PDF se habilitan únicamente cuando `--help-all` anuncia su flag.
La sonda 1.4.4 anuncia versión PDF, texto a paths, ignore-filters y LaTeX; no
anuncia `--export-filter-dpi`, que se rechaza recuperablemente antes de lanzar
Inkscape. El modo LaTeX crea un PDF y un sidecar `.pdf_tex`, por lo que ambos
deben publicarse como grupo lógico cuando se implemente ese modo.
