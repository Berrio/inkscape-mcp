# Referencia de tools MCP

Esta referencia cubre el catálogo estable de `inkscape-mcp` para Windows/stdio.
El schema completo y vigente de entrada/salida de **cada** tool se obtiene con
la petición MCP estándar `tools/list`; el servidor publica ahí los schemas Zod
estrictos, límites, campos opcionales y anotaciones. No copies un schema desde
un cliente antiguo: consulta `tools/list` después de actualizar el paquete.

## Convenciones

- Todas las rutas de documentos, assets y outputs son relativas al workspace;
  nunca se aceptan rutas absolutas ni shell/argv libre.
- Las mutaciones usan la revisión actual en `expectedRevision`; una revisión
  vencida falla sin escribir. Los outputs existentes requieren además su
  revisión esperada.
- Las respuestas MCP incluyen texto breve y `structuredContent`. Los archivos
  grandes se entregan como URI opaca de artefacto, no como blob por stdio.
- Las tools con `action` o `mode` son uniones discriminadas: usa sólo los
  valores que anuncie su schema. Campos desconocidos se rechazan.

Flujo base para una edición: `workspace_list` → `workspace_list_documents` →
`document_inspect` → mutación con revisión → volver a inspeccionar. Para una
exportación: inspección → `document_export_preset_plan` →
`document_export_batch` con el `planToken` de un solo uso.

## Estado, workspace y fuentes

| Tool                       | Schema/operación                                              | Ejemplo de uso                                                  |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| `inkscape_status`          | Sin argumentos; versión, capabilities y postura de seguridad. | Antes de elegir una capability nativa.                          |
| `workspace_list`           | Sin argumentos; IDs opacos de workspaces autorizados.         | Primer paso de cualquier sesión.                                |
| `workspace_list_documents` | `workspaceId`, cursor/límite acotados.                        | Enumerar SVG/SVGZ sin revelar roots.                            |
| `fonts_list`               | `refresh` opcional.                                           | Consultar familias, no archivos de fuentes.                     |
| `fonts_preflight`          | Documento y revisión.                                         | Avisar familias declaradas no resolubles.                       |
| `document_snapshot`        | Documento y `expectedRevision`.                               | Crear restore point opaco antes de una conversión irreversible. |
| `document_restore`         | `snapshotId`, documento y revisión actual.                    | Restaurar un snapshot owner-bound.                              |

## Creación, lectura, páginas y calidad

| Tool                      | Schema/operación                                                               | Ejemplo de uso                                                  |
| ------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `document_create`         | Output relativo más preset o medidas tipadas.                                  | Crear A4 sin sobrescribir un archivo existente.                 |
| `document_inspect`        | Documento, revisión opcional y nivel `summary`, `standard` o `deep`.           | Obtener tamaño, páginas e inventario antes de editar.           |
| `document_preflight`      | Documento y perfil `basic`, `web`, `print` o `interchange`.                    | Detectar fuentes, recursos externos y riesgos de impresión.     |
| `document_optimize`       | Plan `dryRun` o SVG derivado; sólo defs no referenciadas y comparación visual. | Publicar `diseño.optimized.svg` sin alterar el original.        |
| `document_resize`         | Documento/revisión, target tipado y modo permitido.                            | Cambiar lienzo conservando geometría con `page_only`.           |
| `document_fit_page`       | Documento/revisión, bounds nativos y márgenes por lado.                        | Eliminar espacio blanco ajustando la página al dibujo.          |
| `document_page_adjust`    | Documento/revisión y acción `crop`, `expand` u orientación.                    | Añadir bleed temporal o cambiar orientación.                    |
| `document_pages`          | `action` de listar/agregar/actualizar/eliminar/reordenar.                      | Reordenar con IDs de página estables, no por índice.            |
| `document_page_validate`  | Documento/revisión y consulta de bounds nativos.                               | Reportar páginas vacías, solapadas u objetos fuera.             |
| `document_settings`       | Leer o actualizar page/desk/border con revisión.                               | Cambiar color y opacidad de página sin confundir el escritorio. |
| `document_render_preview` | Documento/revisión, área y tamaño PNG limitados.                               | Revisar un preview antes de publicar.                           |
| `document_normalize_ids`  | Documento/revisión y política explícita.                                       | Reparar IDs duplicados antes de exportar o usar actions.        |

## Elementos, capas y composición

| Tool                         | Schema/operación                                                          | Ejemplo de uso                                      |
| ---------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| `elements_query`             | IDs, tipo, layer o selector compuesto seguro; paginación.                 | Buscar `rect.card` sin XPath/CSS arbitrario.        |
| `elements_create`            | Batch de shapes tipadas, estilos allowlisted y layer/grupo.               | Añadir un rectángulo y texto sin enviar XML.        |
| `connector_create`           | Dos endpoints existentes y polilínea de puntos finitos.                   | Conectar dos bloques de un diagrama.                |
| `connector_retarget`         | Conector existente y dos endpoints locales explícitos.                    | Reconectar un conector sin cambiar su ruta.         |
| `connector_route`            | Conector, endpoints/obstáculos simples, clearance y transformación axial. | Recalcular la ruta de un diagrama evitando bloques. |
| `elements_update`            | Patch discriminado de geometría, estilo, texto o layer.                   | Cambiar fill/stroke o etiqueta de capa.             |
| `elements_delete`            | IDs explícitos y revisión.                                                | Eliminar objetos sólo si no rompe referencias.      |
| `elements_duplicate`         | Copia independiente o clone `use`.                                        | Repetir un sello o crear instancia reutilizable.    |
| `elements_reparent`          | IDs y destino group/layer existente.                                      | Mover objetos a una capa conservando orden.         |
| `elements_group`             | Acción group/ungroup y selección válida.                                  | Agrupar elementos hermanos.                         |
| `elements_arrange`           | Acción front/back/step/index/before/after.                                | Llevar un objeto al frente.                         |
| `elements_transform`         | Transform numérica allowlisted, nunca string `transform`.                 | Mover, escalar, rotar o reflejar selección.         |
| `elements_flatten_transform` | IDs de primitivas compatibles.                                            | Hornear translate/scale seguro en geometría.        |
| `elements_align`             | IDs, referencia y eje/alineación.                                         | Centrar elementos con bounds visuales de Inkscape.  |
| `elements_distribute`        | IDs, eje y distribución.                                                  | Repartir objetos por huecos o centros.              |
| `elements_remove_overlaps`   | IDs, eje y gap no negativo; sólo traslación de bounds que se cruzan.      | Separar objetos sin unir ni modificar sus paths.    |
| `document_apply_operations`  | Lista acotada de operaciones tipadas y revisión.                          | Ejecutar varias ediciones como una transacción.     |

## Texto y paths

| Tool                   | Schema/operación                                                            | Ejemplo de uso                                                              |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `text_manage`          | Acción de texto/tspans/multilínea con texto plano limitado.                 | Corregir nombre de una etiqueta.                                            |
| `text_path_manage`     | Adjuntar/desadjuntar texto a un path local.                                 | Curvar texto de un logotipo.                                                |
| `text_to_paths`        | IDs, confirmación destructiva y revisión.                                   | Preparar un PDF cuando no habrá fuentes disponibles.                        |
| `objects_to_paths`     | Shapes/paths vectoriales, modo object/stroke y confirmación.                | Convertir un trazo en contorno editable.                                    |
| `paths_combine`        | Paths hermanos compatibles.                                                 | Unir dos formas sin invocar actions libres.                                 |
| `paths_boolean`        | Dos paths y operación union/difference/intersection/exclusion/division/cut. | Recortar o dividir una silueta mediante Inkscape nativo.                    |
| `path_modify`          | Simplify verificado; inset/outset/offset quedan gateados.                   | Simplificar un path con warning y backup.                                   |
| `paths_flatten`        | Dos a 100 paths y confirmación irreversible.                                | Aplanar objetos superpuestos con staging nativo.                            |
| `path_break_apart`     | Path compuesto y nuevos IDs explícitos.                                     | Separar subpaths preservando referencias seguras.                           |
| `path_reverse`         | Path SVG tipado, incluidas curvas, smooth commands y arcos.                 | Invertir dirección sin aproximar geometría.                                 |
| `path_node_move`       | Path, índice de segmento canónico local y punto finito tipado.              | Mover un endpoint sin enviar `d` libre; el índice no cambia por transforms. |
| `path_node_edit`       | Nodos lineales, open/close, handles Q/C/A y expansión smooth tipada.        | Ajustar una geometría local sin enviar `d` libre.                           |
| `path_effects_inspect` | Efectos LPE locales y paths que los referencian.                            | Auditar efectos sin editar sus parámetros ni depender de GUI.               |
| `path_effects_manage`  | Desadjuntar paths o borrar LPE local sin referencias.                       | Retirar una asociación LPE; no edita parámetros ni re-renderiza un LPE.     |
| `flowed_text_inspect`  | Flow roots y número de párrafos.                                            | Localizar texto heredado de Inkscape.                                       |
| `flowed_text_convert`  | Flow simple de una región y confirmación de pérdida.                        | Recuperar texto SVG editable con warning.                                   |

## Defs, estilos y reutilización

| Tool                       | Schema/operación                                                             | Ejemplo de uso                                      |
| -------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `gradients_manage`         | Crear/reemplazar/aplicar/eliminar gradientes lineales/radiales.              | Reutilizar un degradado en varios objetos.          |
| `mesh_gradients_inspect`   | Lista mesh gradients preservados, filas, patches y referencias.              | Auditar un degradado de malla sin editarlo.         |
| `palette_inspect`          | Colores hex, `currentColor`, CSS local, variables y swatches Inkscape.       | Inventariar colores de un documento.                |
| `palette_apply`            | Mapa explícito `from`/`to` para atributos, CSS/variables y stops.            | Sustituir una paleta sin preferencias globales.     |
| `color_management_inspect` | Perfiles SVG, ICC, CMYK y perfiles sin declarar.                             | Auditar CMYK sin conversión.                        |
| `patterns_manage`          | Crear/reemplazar/aplicar/eliminar dots/stripes tipados.                      | Aplicar patrón sin CSS/XML libre.                   |
| `markers_manage`           | Crear/reemplazar/aplicar/eliminar marcadores arrow/dot.                      | Añadir punta de flecha a una línea.                 |
| `filters_manage`           | Blur, shadow, blend o color matrix tipados.                                  | Aplicar sombra declarada; revisar fidelidad visual. |
| `clips_manage`             | Crear/aplicar/liberar/eliminar clipPath rectangular.                         | Recortar vector sin destruirlo.                     |
| `masks_manage`             | Crear/aplicar/liberar/eliminar máscara rectangular opaca.                    | Ocultar una zona mediante máscara local.            |
| `symbols_manage`           | Listar/crear/eliminar símbolos y crear clones `use`.                         | Crear instancias de un icono.                       |
| `guides_grids_manage`      | Inspeccionar/editar guías y xygrids documentales.                            | Configurar una cuadrícula del archivo, no global.   |
| `defs_vacuum`              | `dryRun` por defecto o eliminación conservadora.                             | Ver defs que se pueden retirar antes de optimizar.  |
| `metadata_manage`          | Title, description, license, creator y keywords en RDF cerrado; ARIA tipado. | Añadir metadata accesible sin RDF/XML libre.        |

## Imágenes, recursos y accesibilidad

| Tool                       | Schema/operación                                       | Ejemplo de uso                                                    |
| -------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `images_manage`            | Link/embed/relink/extract con MIME y paths confinados. | Incrustar una imagen o extraerla a output seguro.                 |
| `images_crop`              | Imagen, clip ID y rectángulo numérico.                 | Recortar sin alterar el raster original.                          |
| `images_trace`             | Preset `default`, máximo 4 MP y confirmación.          | Vectorizar un bitmap local mediante Inkscape.                     |
| `images_inspect_dpi`       | Documento y selección opcional de imágenes.            | Comprobar DPI X/Y efectivo antes de imprenta.                     |
| `resources_inspect_remote` | Documento; sólo inspección.                            | Localizar URLs sin descargarlas.                                  |
| `accessibility_inspect`    | Documento, fondo opaco conocido y límites de análisis. | Revisar orden y contraste heurístico, no auditoría WCAG completa. |

## Importación y empaquetado

| Tool                           | Schema/operación                                                                  | Ejemplo de uso                                            |
| ------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `document_import_capabilities` | Tipos observados y puertas bloqueadas de importación nativa.                      | Confirmar qué formatos faltan validar headlessly.         |
| `document_import`              | SVG/SVGZ local, output, sanitización y pérdidas normalizadas.                     | Convertir SVGZ a SVG saneado con manifest.                |
| `document_import_svg`          | SVG local, output y política.                                                     | Importar un SVG como documento editable nuevo.            |
| `document_import_raster`       | Raster local aprobado, link/embed, límite de megapíxeles y pérdidas normalizadas. | Crear SVG desde un raster aprobado.                       |
| `document_import_pdf`          | PDF local, página, política de fuentes/perfiles, importador gateado y manifest.   | Importar una página y rechazar dependencias no resueltas. |
| `document_import_postscript`   | EPS/PS local, sonda headless, política de dependencias y SVG saneado.             | Importar un EPS sin argumentos nativos libres.            |
| `document_import_emf`          | EMF local validado, sonda headless, política de dependencias y SVG saneado.       | Reimportar un EMF producido de forma confiable.           |
| `assets_package`               | Documento/revisión y directorio nuevo.                                            | Publicar SVG, assets locales y manifest juntos.           |

## Exportación, presets y jobs

| Tool                          | Schema/operación                                                                       | Ejemplo de uso                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `document_export_preset_plan` | Documento/revisión, preset y directorio; devuelve preflight tipado.                    | Revisar preflight de `print-pdf-300dpi` y conservar su token.                                        |
| `document_export_batch`       | `planToken` o specs tipados, modo `all_or_nothing`/`best_effort`.                      | Ejecutar el plan y leer manifest/artefactos publicados.                                              |
| `document_export`             | Un `ExportSpec` discriminado de PNG/PDF/SVG/plain SVG/PS/EPS/EMF/WMF/DXF/HPGL/FXG/SIF. | Exportar DXF, HPGL, FXG o SIF por adapter fijo, con acknowledgement explícito de fidelidad limitada. |
| `export_png`                  | Documento/revisión, área, DPI/píxeles, fondo y output.                                 | Generar PNG transparente a DPI físico o dimensiones exactas.                                         |
| `export_pdf`                  | Documento/revisión, PDF 1.4/1.5, texto/filtros/márgenes permitidos.                    | Exportar PDF multipágina completo o subset controlado.                                               |
| `export_pdf_pages`            | Documento/revisión, IDs de páginas y directorio.                                       | Crear `page-NNN.pdf` por página seleccionada.                                                        |
| `export_svg`                  | Documento/revisión, SVG Inkscape o plain SVG y policy de recursos.                     | Publicar SVG editable o plain SVG validado.                                                          |
| `job_get`                     | `jobId` owner-bound.                                                                   | Consultar progreso/resultado de batch asíncrono.                                                     |
| `job_cancel`                  | `jobId` owner-bound.                                                                   | Pedir cancelación; no publica output incompleto.                                                     |

## Ejemplos de secuencias

### Redimensionar y exportar una etiqueta

1. Llama `document_inspect` sobre `etiquetas/lavanda.svg` y guarda la
   revisión devuelta.
2. Usa `document_resize` o `document_fit_page` con esa revisión y guarda la
   nueva revisión.
3. Llama `document_export_preset_plan` con `print-pdf-300dpi`.
4. Consume el token una sola vez con `document_export_batch`.

### Reemplazar una imagen sin usar rutas del sistema

1. Llama `images_manage` con acción de relink o embed, el ID de imagen y un
   asset relativo del mismo workspace.
2. Revisa el nuevo DPI con `images_inspect_dpi` y recursos con
   `resources_inspect_remote`.
3. Ejecuta `document_preflight` con perfil `print` antes de exportar.

### Recuperar una edición destructiva

1. Crea `document_snapshot` con la revisión inspeccionada.
2. Ejecuta `text_to_paths` u otra mutación confirmada.
3. Si la revisión actual coincide y quieres deshacerla, llama
   `document_restore` con el snapshot owner-bound.

## Errores y recuperación

| Situación                         | Qué hacer                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Revisión u output stale           | Vuelve a inspeccionar, revisa cambios ajenos y reintenta con la nueva revisión.                                      |
| Ruta no permitida                 | Usa una ruta relativa dentro de un workspace configurado; no amplíes roots para evitar el error.                     |
| Capability ausente                | Consulta `inkscape_status` o `document_import_capabilities`; usa la alternativa documentada.                         |
| Token de preset inválido/expirado | Genera un nuevo plan; no reutilices tokens.                                                                          |
| Límite de recurso                 | Reduce DPI, área, lotes, objetos o tamaño de input; no eleves límites sin validar memoria.                           |
| Preflight warning                 | Atiende su remediation o acepta conscientemente el límite visual/fuente/formato.                                     |
| Job cancelado o timeout           | Revisa `job_get`, los artefactos publicados y el troubleshooting; no asumas una transacción entre batches distintos. |

Consulta también [tamaños](./design-size-guide.md), [exportación](./export-guide.md),
[seguridad](./security-workspace-guide.md) y
[troubleshooting](./troubleshooting-windows.md).
