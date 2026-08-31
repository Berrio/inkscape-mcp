# Seguridad operativa, workspaces y recuperación

Inkscape MCP es un servidor local de workspaces, no un sandbox de documentos
hostiles. Esta guía explica las protecciones reales y sus límites para que una
automatización sea segura de operar sin atribuirle aislamiento inexistente.

## Postura que debes comprobar

Ejecuta antes de usar un workspace nuevo:

```powershell
node .\dist\cli.js --doctor --json
```

La salida redacta rutas y declara la configuración. En la build actual, la
postura es:

| Campo                   | Valor                                  | Significado                                                                                    |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `securityLevel`         | `workspace-guarded-native-unsandboxed` | Las rutas, revisiones y publicaciones están protegidas; los parsers nativos no están aislados. |
| `nativeParserIsolation` | `none`                                 | No hay contenedor, sandbox de SO ni helper con handles.                                        |
| `nativeInputPolicy`     | `trusted-local-only`                   | Sólo procesa entradas locales que tú consideres confiables.                                    |
| `maximumSanitizeMode`   | Normalmente `preserve-local`           | Fija el máximo de saneamiento autorizado al arrancar; una tool no puede elevarlo.              |

La tool `inkscape_status` muestra la misma postura junto con
`residualRisks`. Si alguno de estos valores cambia, revisa la configuración y
la documentación antes de automatizar.

## Elegir y mantener un workspace

Inicia el servidor o la CLI sólo con el directorio de diseños que quieras
exponer:

```powershell
node .\dist\cli.js --workspace-root "C:\disenos"
```

Las tools reciben únicamente rutas relativas a ese root. El servidor rechaza
rutas absolutas, UNC, drive-relative, traversal (`..`), NUL y formas de ruta
que puedan salir del workspace. Scratch, fuentes, ejecutable y data dirs no
son navegables desde el cliente; los resultados no revelan paths absolutos.

Usa un directorio privado del usuario que corre el proceso. No uses una carpeta
compartida con software o usuarios que puedan escribir durante una operación:
un escritor local hostil puede intentar carreras con junctions/reparse points,
un riesgo que Node sin helper nativo no elimina.

## Revisiones, outputs y backups

Todas las mutaciones in-place requieren `expectedRevision`, el SHA-256 de
`document_inspect`. Si otra operación cambió el SVG, la mutación falla en vez
de sobrescribir su contenido. No reintentes con el hash antiguo: inspecciona,
compara y decide de nuevo.

Un output nuevo debe usar una ruta relativa que no exista. Para reemplazarlo,
obtén su hash actual y envíalo como `expectedOutputRevision`; de lo contrario
el servidor rechaza la sobrescritura. Esta regla evita que dos automatizaciones
publiquen silenciosamente sobre el mismo archivo.

Cada edición in-place crea un backup antes del reemplazo bajo la política
`on-in-place-mutation`. Para una restauración deliberada, usa
`document_snapshot` antes de mutar y `document_restore` con su ID opaco y la
revisión actual. No copies archivos temporales para recuperar cambios: los
temporales no son una API y se limpian tras éxito, error o cancelación.

Los lotes publican archivos relacionados con locks, staging y rollback ante un
fallo manejado. Un crash del proceso entre múltiples renames no puede ser una
transacción atómica del filesystem; por eso conserva el recibo de receta y
verifica las revisiones de los outputs después de una interrupción.

## Qué protege la entrada nativa

Antes de invocar Inkscape, el servidor prepara un bundle inmutable en staging,
limita tamaño, sanea SVG bajo la política configurada, reescribe dependencias
locales permitidas y vuelve a comprobar revisiones antes de publicar. Rechaza
contenido activo, recursos remotos y argumentos o acciones nativas arbitrarias.

Esto protege contra rutas inesperadas, inyección de argumentos, XML activo y
publicación inconsistente dentro de los límites declarados. No prueba que
Inkscape, Poppler, PNG/JPEG/WebP/GIF u otro parser no tenga vulnerabilidades.
Un Job Object, timeout, límite de memoria/bytes o sanitización no convierte a
un parser nativo en sandboxed.

## Uso autónomo seguro

- Ejecuta `inkscape-mcp export --dry-run` antes de publicar un preset.
- En recetas, coloca `inspect` y `preflight` antes de cada `export`.
- Guarda el recibo JSON, hashes, preflight y SVG fuente con la entrega.
- Si una receta falla o el equipo se reinicia, inspecciona outputs y vuelve a
  ejecutar sólo tras resolver colisiones o revisiones obsoletas.
- No incluyas rutas absolutas, documentos o secretos en logs que compartas.

El transporte HTTP experimental nunca es una vía para exponer el MCP fuera del
equipo: sólo escucha `127.0.0.1`, valida Host/Origin y exige bearer local. Un
token único se inyecta por `INKSCAPE_MCP_HTTP_TOKEN`; para rotarlo sin reinicio
puedes usar `INKSCAPE_MCP_HTTP_TOKENS_FILE` con reemplazo atómico y ACL privada.
HTTP liga artifacts, recursos, jobs, planes y snapshots al principal
autenticado y emite sólo telemetría estructurada redactada a stderr. No
configures proxies, túneles ni binds alternativos. Consulta la
[guía HTTP](./http-security.md): faltan conformance HTTP moderno, sandbox y
autorización por ACL de filesystem antes de anunciarlo como transporte estable.
