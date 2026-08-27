# Resolución de problemas en Windows

Esta guía parte del resultado real de `--doctor`, `inkscape_status` y los
recibos de recetas. No soluciones un fallo desactivando revisiones, ampliando
un workspace a todo el disco ni copiando rutas MSIX versionadas.

## Primera comprobación

Ejecuta estos comandos desde el repositorio:

```powershell
node .\dist\cli.js --doctor --json
npm run check
```

Para ejecutar una entrega sin IA, conserva también el JSON que devuelve la
receta:

```powershell
inkscape-mcp run .\exportaciones.json `
  --workspace-root C:\disenos > .\logs\ultimo-recibo.json
```

El exit code es `0` para éxito, `2` para receta inválida y `3` para fallo de
ejecución MCP/Inkscape. El recibo y el log de PowerShell son la evidencia para
diagnosticar una salida faltante.

## Inkscape no aparece o el doctor informa diagnósticos

| Síntoma                         | Causa habitual                                                               | Acción segura                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Inkscape: not found`           | Inkscape no está instalado, o discovery no encuentra una instalación válida. | Instala/abre Inkscape, ejecuta de nuevo `--doctor` y verifica versión/capabilities.                                    |
| MSIX cambia de ruta             | Una actualización de Microsoft Store cambió `WindowsApps`.                   | No hardcodees ni tomes posesión de `WindowsApps`; usa discovery MSIX.                                                  |
| Instalador normal no se detecta | PATH/registro/App Paths no lo expone.                                        | Configura `--inkscape-bin "C:\Program Files\Inkscape\bin\inkscape.exe"` sólo al arrancar y vuelve a ejecutar doctor.   |
| Warnings GTK en stderr          | Mensajes de la librería gráfica.                                             | No los ignores ciegamente, pero no son fallo por sí mismos: decide por exit code, artifact verificado y resultado MCP. |

Consulta [Inkscape en Windows](./windows-inkscape.md) para el detalle de MSIX.
Nunca envíes una ruta de ejecutable como argumento de una tool MCP.

## El servidor abre, pero no ve documentos

- Arráncalo con al menos un `--workspace-root`. Sin ello, doctor puede funcionar,
  pero las tools de documento devuelven `Document tools require at least one
configured workspace root`.
- Llama `workspace_list` y usa el `workspaceId` devuelto. Todas las rutas de
  tools, recetas y outputs son relativas a ese root.
- `PATH_OUTSIDE_WORKSPACE`, `PATH_INVALID` o `PATH_NOT_FOUND` indican una ruta
  absoluta, traversal, archivo inexistente o directorio padre de output que no
  existe. Corrige la estructura del workspace; no cambies el root por `C:\`.
- Para recetas/presets, el directorio de salida se crea controladamente. Para
  una exportación individual, crea de antemano el directorio relativo permitido.

## Revisión u output en conflicto

| Mensaje o resultado                                     | Qué significa                                                          | Recuperación                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Document revision no longer matches`                   | El SVG cambió desde `document_inspect`.                                | Inspecciona otra vez, revisa el cambio y repite usando la nueva revisión.                      |
| `Overwriting an output requires expectedOutputRevision` | El output ya existe y no se permite reemplazarlo sin comparar su hash. | Elige otro nombre o calcula/obtén la revisión actual y envíala como `expectedOutputRevision`.  |
| `Output existence changed before publication`           | Otro proceso creó o borró el output durante la operación.              | Detén el proceso competidor, reinspecciona y reintenta; no borres outputs indiscriminadamente. |
| Plan token inválido/expirado                            | El plan es de un solo uso y caduca.                                    | Ejecuta de nuevo el preflight/preset; no intentes reutilizar el token.                         |

Las mutaciones in-place crean backup bajo `on-in-place-mutation`. Antes de un
cambio importante, crea además un `document_snapshot`; restaura sólo mediante
`document_restore` y una revisión vigente.

## Fuentes y texto distinto

Ejecuta `fonts_preflight` antes de un PDF o SVG que deba verse igual en otra
máquina. El resultado puede señalar familias ausentes; no verifica cobertura de
glyphs ni permisos de embedding.

- Instala legalmente la fuente en la máquina que exporta y vuelve a ejecutar el
  preflight.
- Si la entrega no debe depender de fuentes, usa `textToPath: true` al exportar
  PDF/SVG. Conserva el SVG editable original: los contornos pierden edición,
  búsqueda y copia como texto.
- Si una fuente figura presente pero el resultado cambia, revisa peso, estilo,
  glyphs y una preview/PDF real. No asumas que nombres de familia equivalen a
  la misma tipografía.

## Capability o formato no disponible

`--doctor --json` es la fuente local de verdad para opciones y tipos de entrada.

- Si `filterDpi` o `print-pdf-300dpi` falla por capability, la build no anuncia
  `--export-filter-dpi`. Usa `print-a4-pdf` o exporta PDF sin esa opción; no se
  simula 300 DPI.
- Si una extensión aparece en `inputTypes` pero no existe tool de importación,
  sigue sin estar soportada. Actualmente los adaptadores prácticos son
  SVG/SVGZ, PNG/JPEG/GIF/WebP y PDF de una página.
- PS/EPS/EMF/WMF/XAML, SVGZ de salida, JPG/WebP/TIFF de salida, PDF/X y CMYK
  profesional no se anuncian como entregables estables. Consulta la
  [matriz de compatibilidad](./compatibility-matrix.md).

## Filtros, PDFs y PNG que no se ven como esperabas

1. Ejecuta `document_preflight` con perfil `print`, `web` o `interchange`.
2. Revisa warnings de filtros, recursos externos, `foreignObject`, fuentes y
   features de Inkscape.
3. Para PNG, fija área y DPI **o** dimensiones de píxeles; no mezcles ambos.
4. Para PDF, revisa `pageCount`, `MediaBoxes`, `CropBoxes` y warnings. Si
   ignoras filtros o conviertes texto a paths, el resultado lo declara.
5. Para SVG plano, abre el derivado en el renderer de destino; XML válido no
   garantiza equivalencia visual entre motores.

Las guías de [tamaños](./design-size-guide.md) y
[exportación](./export-guide.md) detallan los contratos por formato.

## Recetas, logs y salidas parciales

Una receta valida esquema, fuente, capabilities y colisiones de outputs antes
de publicar su primer export. Cada export se publica con su lote atómico
habitual; no se promete una transacción única que abarque operaciones de
exportación distintas de la misma receta.

Después de un corte de energía, cancelación o fallo:

1. Lee el exit code, el recibo y el log.
2. Lista/inspecciona los outputs esperados y sus revisiones.
3. Conserva los archivos correctos; resuelve sólo los nombres en conflicto.
4. Vuelve a ejecutar la receta desde un preflight nuevo si corresponde.

El runner `Invoke-InkscapeMcpRecipe.ps1` crea el directorio de log, propaga el
exit code y acepta `-NonInteractive`. Para una tarea diaria, ejecuta primero
`Register-InkscapeMcpDailyTask.ps1 ... -WhatIf`; no registra credenciales ni
abre GUI.

## Cuándo detenerse

Detén la automatización y revisa manualmente si:

- el input viene de un tercero no confiable;
- cambió una fuente, filtro o la apariencia de un PDF;
- hay warnings de recursos externos/contenido activo;
- se repiten conflictos de revisión o output, o aparece un parser crash;
- necesitas HTTP, GUI, CMYK/PDF-X o un formato no anunciado.

El baseline es `trusted-local-only` y no contiene parsers nativos en un sandbox.
La [guía de seguridad](./security-workspace-guide.md) explica las protecciones
y riesgos residuales.
