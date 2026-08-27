# inkscape-mcp

Servidor MCP local, por `stdio`, para controlar Inkscape headless de forma
acotada. Gestiona documentos SVG/Inkscape, diseño vectorial tipado, recursos
locales y exportaciones verificadas a PNG, PDF y SVG.

## Lo que funciona hoy

- Descubrimiento de Inkscape, incluido el paquete MSIX de Windows, y
  `--doctor` con evidencia de capacidades.
- Workspaces autorizados con rutas relativas seguras, revisiones SHA-256,
  locks, backups y commits atomicos.
- Crear, inspeccionar y redimensionar documentos SVG con semántica
  `page_only`, medidas custom o presets A3/A4/Letter, y páginas iniciales.
- Paginas explicitas de Inkscape 1.4: listar, agregar, actualizar, borrar y
  reordenar con IDs estables.
- Ajustes tipados de pagina: color/opacidad de pagina, color de escritorio y
  color/opacidad del borde.
- Diseño vectorial tipado: formas, capas, grupos, orden Z, transformaciones,
  alineación/distribución, paths seleccionados, texto/tspans, metadatos,
  gradientes, patrones, marcadores, filtros, clips, máscaras, símbolos,
  clones, guías y cuadrículas.
- Imágenes locales PNG/JPEG/GIF/WebP con enlace o embed, relink/extract, crop
  no destructivo, DPI efectivo, recursos remotos y diagnósticos básicos de
  accesibilidad.
- Importación saneada de SVG/SVGZ con manifiesto SHA-256 y límites contra
  expansión gzip; el catálogo de importadores nativos se consulta en runtime.
- Lotes de exportación verificados, artefactos, jobs y presets `icon-pack`,
  `web-asset-pack`, `print-pdf-300dpi`, `plain-svg` y entregables individuales.

No acepta XML, comandos de shell ni rutas absolutas libres desde el cliente.
Consulta el [plan maestro](./PLAN_IMPLEMENTACION.md) para formatos y funciones
avanzadas que aún están pendientes.

## Requisitos

- Node.js 24.x y npm 11.x.
- Inkscape 1.4.4 o compatible. En Windows se detectan instalaciones PATH,
  App Paths, registro y MSIX; confirma la detección con `--doctor`.

## Ejecutar localmente

```powershell
npm ci
npm run check
npm run test:mcp
node dist/cli.js --doctor --json
node dist/cli.js --workspace-root C:\ruta\a\tus\disenos
```

El último comando mantiene el protocolo MCP exclusivamente en stdout. Configura
tu cliente MCP para iniciarlo con `node`, argumento `dist/cli.js`, y uno o más
argumentos `--workspace-root`; solo esos directorios serán visibles para las
tools. Usa rutas de Windows entre comillas si contienen espacios.

Ejemplo de configuración stdio para un cliente MCP:

```json
{
  "mcpServers": {
    "inkscape": {
      "command": "node",
      "args": [
        "C:\\ruta\\a\\InKscape-MCP\\dist\\cli.js",
        "--workspace-root",
        "C:\\ruta\\a\\mis-disenos"
      ]
    }
  }
}
```

Primero llama `workspace_list`, después `document_inspect` para obtener la
revisión, y envíala como `expectedRevision` en cada mutación. Nunca reutilices
una revisión después de que otra operación haya cambiado el documento.

## Exportar sin un cliente de IA

La CLI `export` abre un servidor MCP local temporal y usa exclusivamente sus
tools públicas: obtiene la revisión vigente del SVG, hace preflight del preset
y publica el lote de forma atómica. No acepta shell, XML ni rutas de documento
fuera del workspace. Por tanto se puede usar directamente desde PowerShell,
incluso cuando no haya una sesión de Codex o de otro modelo activa:

```powershell
inkscape-mcp export `
  --source etiquetas.svg `
  --preset print-pdf-300dpi `
  --output-directory entregables `
  --workspace-root C:\ruta\a\tus\disenos
```

Los presets admitidos son `print-a4-pdf`, `print-pdf-300dpi`, `web-png`,
`web-asset-pack`, `plain-svg` e `icon-pack`. Añade `--dry-run` para obtener
JSON con las rutas, digest y vencimiento del plan sin crear directorios ni
publicar archivos. Si se configuran varios workspaces, selecciona uno por su
índice estable de la sesión con `--workspace-index 0` a `31`.

Para varios pasos, guarda una receta JSON cerrada y ejecútala sin IA:

```json
{
  "schema": "inkscape-mcp-recipe/v1",
  "source": "etiquetas.svg",
  "operations": [
    { "kind": "inspect" },
    {
      "kind": "preflight",
      "preset": "print-pdf-300dpi",
      "outputDirectory": "entregables"
    },
    {
      "kind": "export",
      "preset": "web-asset-pack",
      "outputDirectory": "web"
    }
  ]
}
```

```powershell
inkscape-mcp run .\exportaciones.json --workspace-root C:\ruta\a\tus\disenos
```

`run` devuelve un recibo JSON `inkscape-mcp-recipe-receipt/v1`; redirígelo a
un archivo si deseas conservarlo. Sus códigos de salida son `0` (éxito), `2`
(receta inválida) y `3` (fallo de ejecución). Se validan esquema, fuente,
capabilities, rutas y colisiones entre outputs previstos antes de publicar el
primer export; cada export se publica mediante su lote atómico habitual.

### Automatización de Windows

El paquete incluye los scripts PowerShell
`scripts\windows\Invoke-InkscapeMcpRecipe.ps1` y
`scripts\windows\Register-InkscapeMcpDailyTask.ps1`. El primero ejecuta una
receta y deja un log, sin abrir GUI ni solicitar credenciales:

```powershell
& .\scripts\windows\Invoke-InkscapeMcpRecipe.ps1 `
  -RecipePath C:\disenos\exportaciones.json `
  -WorkspaceRoot C:\disenos `
  -LogPath C:\disenos\logs\exportaciones.log `
  -NonInteractive
```

El segundo **sólo cuando tú lo ejecutes** registra una tarea diaria para el
usuario actual en modo `Interactive`, sin contraseña almacenada; por tanto se
ejecuta mientras ese usuario haya iniciado sesión. Antes puedes inspeccionarlo
con `-WhatIf`:

```powershell
& .\scripts\windows\Register-InkscapeMcpDailyTask.ps1 `
  -TaskName "Inkscape MCP - etiquetas" `
  -RecipePath C:\disenos\exportaciones.json `
  -WorkspaceRoot C:\disenos `
  -LogPath C:\disenos\logs\exportaciones.log `
  -DailyAt "02:00" -WhatIf
```

Después de verificar la salida, elimina `-WhatIf` para registrar la tarea.
El script no añade privilegios, no expone HTTP y no guarda credenciales.

## Tools MCP actuales

| Grupo              | Tools principales                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estado y archivos  | `inkscape_status`, `workspace_list`, `workspace_list_documents`, `document_snapshot`, `document_restore`                                                                                                                                                |
| Documento          | `document_create`, `document_inspect`, `document_resize`, `document_fit_page`, `document_page_adjust`, `document_pages`, `document_page_validate`, `document_settings`, `document_preflight`, `document_render_preview`                                 |
| Diseño             | `elements_create`, `elements_query`, `elements_update`, `elements_delete`, `elements_transform`, `elements_flatten_transform`, `elements_arrange`, `elements_group`, `elements_duplicate`, `elements_reparent`, `elements_align`, `elements_distribute` |
| Texto y paths      | `text_manage`, `text_path_manage`, `text_to_paths`, `paths_combine`, `paths_boolean`, `path_break_apart`, `path_reverse`                                                                                                                                |
| Recursos SVG       | `gradients_manage`, `patterns_manage`, `markers_manage`, `filters_manage`, `clips_manage`, `masks_manage`, `defs_vacuum`, `symbols_manage`, `guides_grids_manage`, `metadata_manage`                                                                    |
| Imágenes y calidad | `images_manage`, `images_crop`, `images_inspect_dpi`, `resources_inspect_remote`, `accessibility_inspect`, `fonts_list`, `fonts_preflight`                                                                                                              |
| Importación        | `document_import`, `document_import_capabilities`, `document_import_svg`, `assets_package`, `document_normalize_ids`                                                                                                                                    |
| Exportación        | `document_export`, `document_export_preset_plan`, `document_export_batch`, `export_png`, `export_pdf`, `export_pdf_pages`, `export_svg`, `job_get`, `job_cancel`                                                                                        |

Las mutaciones y exportaciones exigen `expectedRevision`. Si un archivo cambia
entre la lectura y el commit, la operación falla en lugar de sobrescribir una
revisión ajena. Toda exportación entrega a Inkscape una copia verificada del
SVG en staging, nunca la ruta viva del workspace.

## Seguridad y estado

El proyecto no promete aislar vulnerabilidades desconocidas de parsers nativos.
Limita rutas, XML, argumentos, procesos, tamaños y sobrescrituras; la política
actual de input nativo es `trusted-local-only`. La exportación rechaza SVG con
contenido activo o recursos remotos antes de iniciar Inkscape; las mutaciones
de resize aplican la misma regla.

Las instrucciones de contribución y los invariantes se encuentran en
[AGENTS.md](./AGENTS.md). El paquete sigue siendo privado: publicarlo en npm o
en un registry requerira autorizacion explicita separada.

## Licencia

[MIT](./LICENSE) Copyright 2026 Berrio.
