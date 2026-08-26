# ADR-010: Geometría de documento y viewBox

Usamos 96 CSS px/in y mantenemos separadas unidades físicas del viewport y unidades de usuario del `viewBox`. `page_only` usa `preserve_user_scale` por defecto: cambia el `viewBox` proporcionalmente y no transforma elementos. `preserve_viewbox` conserva coordenadas pero advierte `DOCUMENT_SCALE_CHANGED`.

Contain y cover producen una matriz explícita con fidelidad exacta para geometría simple; el escalado DOM completo y CSS avanzan solo tras declarar fidelidad. Los vectores normativos de §10 están cubiertos por tests con tolerancia de punto flotante.

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
