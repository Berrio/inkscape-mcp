# ADR-010: Geometría de documento y viewBox

Usamos 96 CSS px/in y mantenemos separadas unidades físicas del viewport y unidades de usuario del `viewBox`. `page_only` usa `preserve_user_scale` por defecto: cambia el `viewBox` proporcionalmente y no transforma elementos. `preserve_viewbox` conserva coordenadas pero advierte `DOCUMENT_SCALE_CHANGED`.

Contain y cover producen una matriz explícita con fidelidad exacta para geometría simple; el escalado DOM completo y CSS avanzan solo tras declarar fidelidad. Los vectores normativos de §10 están cubiertos por tests con tolerancia de punto flotante.

## Tolerancias de los vectores normativos

Los cinco vectores de la sección 10.2 son contratos del modelo geométrico puro.
Cada componente numérico (rectángulo, escala, offset y dimensión) se compara
con `toBeCloseTo(..., 12)`: una tolerancia absoluta estrictamente menor que
`5e-13` en la unidad del vector. Los warnings se comparan exactamente, sin
tolerancia.

| Vector                   | Resultado normativo                                                           |
| ------------------------ | ----------------------------------------------------------------------------- |
| A4 `preserve_user_scale` | `viewBox=(0,0,148,210)` y ningún warning                                      |
| A4 `preserve_viewbox`    | `viewBox=(0,0,210,297)`, factor físico `2` por eje y `DOCUMENT_SCALE_CHANGED` |
| contain centrado         | matriz `(1.35,0,0,1.35,0,135)`                                                |
| cover centrado           | matriz `(1.8,0,0,1.8,-180,0)` y `CONTENT_MAY_BE_CROPPED`                      |
| fit con bounds negativos | rectángulo `(-13,17,106,56)` y `FIT_USED_VISUAL_BOUNDS`                       |

Esta tolerancia no se aplica a medidas observadas por Inkscape. Esas siguen
siendo evidencia nativa de fidelidad parcial y usan la tolerancia de `0.01`
unidades fijada para F03-G03.

## Contrato de bounds

Los bounds no son intercambiables:

- `geometric` describe solamente la geometría sin expansión de pintura. El
  backend DOM actual no tiene un motor SVG/CSS probado para calcularlo, así que
  lo anuncia como `approximate` con
  `GEOMETRIC_ENGINE_UNAVAILABLE`; nunca inventa precisión exacta.
- `visual` procede de la observación nativa `inkscape --query-all`. Se expone
  como `partial`, no como prueba de geometría: sus números pueden depender de
  la interpretación nativa de pintura y no sustituyen un layout CSS calculado.
- `approximate` es el único resultado permitido cuando hay transforms,
  stroke, markers, filters, cascade CSS, `!important`, `currentColor`,
  variables, porcentajes, `objectBoundingBox` o `non-scaling-stroke` sin un
  motor compatible que haya superado el corpus correspondiente.

Las coordenadas negativas son válidas y no reducen por sí mismas la fidelidad.
Toda API que devuelva una caja debe incluir `kind`, `fidelity`, `source` y las
limitaciones aplicables. Un motor geométrico futuro solo podrá elevar la
fidelidad tras añadir fixtures y tolerancias para cada feature que soporte.
