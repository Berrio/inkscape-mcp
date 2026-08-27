# Auditoría de logs y datos sensibles

Revisión realizada el 2026-08-27 para el transporte Windows/stdio.

## Resultado

- El servidor MCP no usa `console.*`; stdout del proceso servidor queda
  reservado para JSON-RPC. Los comandos informativos (`--help`, `--version`,
  `--doctor`, `export`, `run`) escriben stdout únicamente porque no sirven
  transporte MCP.
- Diagnósticos de arranque y errores de stdio se escriben en stderr mediante
  `redactDiagnostic`: elimina rutas Windows/UNC y valores con forma de token,
  clave API, autorización, contraseña o secreto antes de escribirlos.
- `redactConfig` no publica roots, scratch ni ejecutables; expone estado y
  límites. Artefactos, snapshots y manifests públicos usan IDs/URIs opacos y
  no paths absolutos.
- No se registran SVG completos, blobs raster, variables de entorno ni tokens
  de plan. Un `planToken` sólo se devuelve como dato MCP owner-bound y de un
  uso; no es parte de logging.

## Cobertura

- `tests/unit/config.test.ts` fija redacción de una ruta y credenciales con
  forma de secreto.
- `scripts/test-mcp.mjs` comprueba negociación moderna/legacy por stdio; el
  servidor no introduce bytes de log en stdout.
- Las búsquedas de auditoría incluyen todos los usos de `process.stdout`,
  `process.stderr`, `console`, `JSON.stringify` y campos de rutas internas.

## Límite

Los mensajes de herramientas MCP son respuestas para el cliente autorizado,
no logs. Cada herramienta conserva su schema/redacción propia; al añadir una
nueva, no se debe convertir una ruta absoluta, el XML del documento ni un
secreto en texto libre de error.
