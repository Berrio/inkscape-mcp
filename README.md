# inkscape-mcp

Servidor MCP local, por `stdio`, para controlar Inkscape headless de forma
acotada. Esta version pre-alpha se centra en documentos SVG/Inkscape, tamanos,
paginas y exportaciones verificadas a PNG, PDF y SVG.

## Lo que funciona hoy

- Descubrimiento de Inkscape, incluido el paquete MSIX de Windows, y
  `--doctor` con evidencia de capacidades.
- Workspaces autorizados con rutas relativas seguras, revisiones SHA-256,
  locks, backups y commits atomicos.
- Crear, inspeccionar y redimensionar documentos SVG con semantica
  `page_only`, medidas custom o presets A3/A4/Letter, y paginas iniciales.
- Paginas explicitas de Inkscape 1.4: listar, agregar, actualizar, borrar y
  reordenar con IDs estables.
- Ajustes tipados de pagina: color/opacidad de pagina, color de escritorio y
  color/opacidad del borde.
- Preflight basico de SVG y exportaciones PNG, PDF 1.4/1.5 y SVG plano o de
  Inkscape. Los resultados se verifican antes de publicarse.

Todavia no es un editor vectorial completo: no anuncia manipulacion general de
objetos, capas, texto, paths, selecciones, filtros ni dependencias locales.
Consulta el [plan maestro](./PLAN_IMPLEMENTACION.md) para el alcance y las
tareas pendientes.

## Requisitos

- Node.js 24.x y npm 11.x.
- Inkscape 1.4.4 o compatible. En Windows se detecta automaticamente la
  instalacion MSIX observada durante el desarrollo.

## Ejecutar localmente

```powershell
npm ci
npm run check
npm run test:mcp
node dist/cli.js --doctor --json
node dist/cli.js --workspace-root C:\ruta\a\tus\disenos
```

El ultimo comando mantiene el protocolo MCP exclusivamente en stdout. Configura
tu cliente MCP para iniciarlo con `node`, argumento `dist/cli.js`, y uno o mas
argumentos `--workspace-root`; solo esos directorios seran visibles para las
tools de documentos.

## Tools MCP actuales

| Tool                                                     | Uso                                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inkscape_status`                                        | Estado, capacidades y postura de seguridad.                                                                                                                    |
| `workspace_list`, `workspace_list_documents`             | Workspaces disponibles y SVG/SVGZ permitidos.                                                                                                                  |
| `document_create`, `document_inspect`, `document_resize` | Crear y gestionar viewport, unidades, `viewBox`, paginas, anchors, contain/cover/stretch, revision e inventario SVG.                                           |
| `document_pages`                                         | Listar o mutar paginas explicitas de Inkscape 1.4.                                                                                                             |
| `document_settings`                                      | Leer o editar fondo de pagina, escritorio y borde.                                                                                                             |
| `document_preflight`                                     | Detectar contenido activo, recursos externos y errores con perfiles basic/web/print/interchange.                                                               |
| `elements_update`                                        | Actualizar geometría, estilo básico, texto o label de capa mediante patches tipados.                                                                           |
| `elements_arrange`                                       | Cambiar orden Z de hermanos: front/back/raise/lower, sin índices u orden XML arbitrarios.                                                                      |
| `elements_group`                                         | Agrupar hermanos o desagrupar un grupo SVG sin romper referencias `href` externas.                                                                             |
| `elements_query`                                         | Consultar resúmenes acotados por ID, tipo o capa, con paginación y `missingIds`.                                                                               |
| `elements_create`                                        | Crear formas, texto, grupos y capas tipados; soporta parentId dentro del batch.                                                                                |
| `elements_delete`                                        | Borrar IDs seleccionados sin dejar referencias fragmentarias rotas.                                                                                            |
| `elements_transform`                                     | Transformar elementos con translate, scale, rotate, skew, flip o matrix tipados.                                                                               |
| `export_png`, `export_pdf`, `export_svg`                 | Exportar por Inkscape mediante staging y validar el artefacto; PNG acepta area/DPI/fondo, PDF informa paginas y MediaBox, y SVG puede convertir texto a paths. |

Las mutaciones y exportaciones exigen `expectedRevision`. Si un archivo cambia
entre la lectura y el commit, la operacion falla en lugar de sobrescribir una
revision ajena. Toda exportacion entrega a Inkscape una copia verificada del SVG
en staging, nunca la ruta viva del workspace.

## Seguridad y estado

El proyecto no promete aislar vulnerabilidades desconocidas de parsers nativos.
Limita rutas, XML, argumentos, procesos, tamanos y sobrescrituras; la politica
actual de input nativo es `trusted-local-only`. La exportacion rechaza SVG con
contenido activo o recursos remotos antes de iniciar Inkscape; las mutaciones
de resize aplican la misma regla.

Las instrucciones de contribucion y los invariantes se encuentran en
[AGENTS.md](./AGENTS.md). El paquete sigue siendo privado: publicarlo en npm o
en un registry requerira autorizacion explicita separada.

## Licencia

[MIT](./LICENSE) Copyright 2026 Berrio.
