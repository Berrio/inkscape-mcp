# ADR-013: no adoptar `inkscape --shell` persistente en el núcleo

## Estado

Aceptada el 2026-10-07 (F12-T01/T02).

## Contexto

El plan pedía medir un worker `inkscape --shell` persistente antes de decidir si mejora la latencia sin reducir la fiabilidad. `npm run bench:f12-shell` (`scripts/bench-f12-shell.mjs`) compara procesos batch de vida corta con una sesión `--shell` que abre, exporta y cierra cada documento (`file-open; export-type; export-filename; export-do; file-close`) y verifica cada PNG.

Medición en Windows 11, Inkscape 1.4.4 MSIX, SVG de 64×64 px, 30 exportaciones:

| Modo                               | Media por exportación |  Mediana |   Máximo |  Total |
| ---------------------------------- | --------------------: | -------: | -------: | -----: |
| Batch (un proceso por exportación) |              1.598 ms | 1.534 ms | 2.550 ms | 47,9 s |
| `--shell` ya arrancado             |                 11 ms |    10 ms |    18 ms | 0,32 s |

Otros datos:

- arranque de la sesión `--shell`: 1,3–2,3 s;
- memoria (working set del árbol): 81 → 87,5 MiB tras 30 exportaciones, unos 0,2 MiB por exportación;
- desde que se mata la sesión hasta la primera exportación correcta en una sesión nueva: unos 2 s.

En el batch, el coste dominante es el arranque de Inkscape. En documentos reales, el render pesa más y la diferencia relativa será menor que en este fixture mínimo.

## Decisión

El núcleo 1.0 sigue usando procesos batch de vida corta. No se añade un worker `--shell`, porque la ganancia de latencia no compensa lo que se pierde en fiabilidad y seguridad:

1. **Sin resultado por comando.** El protocolo es texto interactivo delimitado por el prompt `>`. Un fallo sólo aparece en stderr; no hay código de salida por exportación. Hoy cada proceso tiene exit code, timeout y verificación propios.
2. **Inyección en la cadena de acciones.** Las acciones se separan con `;`. Una ruta con `;`, salto de línea o `:` mal escapado altera el comando. Habría que restringir el alfabeto de rutas del staging y reescapar cada argumento: es una superficie nueva que el runner actual evita por diseño (argv sin shell).
3. **Estado compartido entre peticiones.** Preferencias, cachés de fuentes y documentos que no se cierren bien persisten entre exportaciones. Con varios principals HTTP, un worker no puede compartirse entre owners.
4. **Confinamiento y concurrencia.** El runner no ofrece stdin interactivo, y el Job Object (ADR-012) envuelve procesos de vida corta. Un worker exigiría:
   - un nuevo modo de runner;
   - un worker por slot del semáforo;
   - política de reciclado por TTL, por número de exportaciones y por memoria;
   - recuperación con el coste de arranque medido.
5. **Fiabilidad ya probada.** Las 27 puertas E2E, la cancelación y la recuperación están verificadas sobre el modelo batch.

## Condiciones para reconsiderar

Un worker sólo se aceptaría como camino **opt-in** para previews de baja latencia, nunca para publicar artefactos finales, y con todas estas condiciones:

- un worker por owner y por slot, reciclado tras 50 exportaciones, 10 minutos o 256 MiB de working set;
- rutas de staging generadas por el servidor con alfabeto `[A-Za-z0-9._-]` y rechazo de cualquier otra;
- verificación estructural obligatoria del artefacto, y vuelta inmediata al batch ante cualquier anomalía: prompt ausente, stderr inesperado o artefacto inválido;
- el worker dentro de su propio Job Object, con la misma cancelación y el mismo timeout;
- una puerta E2E propia antes de anunciarlo (F12-G01).

## Consecuencias

La latencia por exportación sigue siendo de ~1,5–2 s en este host. Los flujos por lotes ya amortizan parte de ese coste con `document_export_batch` y la concurrencia configurada. El benchmark queda versionado para repetir la medición con otras versiones de Inkscape.
