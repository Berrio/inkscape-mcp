# ADR-010: Geometría de documento y viewBox

Usamos 96 CSS px/in y mantenemos separadas unidades físicas del viewport y unidades de usuario del `viewBox`. `page_only` usa `preserve_user_scale` por defecto: cambia el `viewBox` proporcionalmente y no transforma elementos. `preserve_viewbox` conserva coordenadas pero advierte `DOCUMENT_SCALE_CHANGED`.

Contain y cover producen una matriz explícita con fidelidad exacta para geometría simple; el escalado DOM completo y CSS avanzan solo tras declarar fidelidad. Los vectores normativos de §10 están cubiertos por tests con tolerancia de punto flotante.
