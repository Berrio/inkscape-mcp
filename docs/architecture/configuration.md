# Configuración inicial

La configuración usa JSON estricto. La precedencia es flags de inicio > variables de entorno allowlisted > archivo JSON > defaults seguros.

`doctor` puede arrancar sin `workspaceRoots` y devuelve `workspaceReady: false`. Las tools que abren o escriben documentos exigirán al menos un root configurado.

```json
{
  "transport": "stdio",
  "workspaceRoots": ["C:/design-workspace"],
  "scratchRoot": "auto",
  "inkscapeBin": "auto",
  "maxConcurrency": 2,
  "processTimeoutMs": 60000,
  "http": {
    "host": "127.0.0.1",
    "port": 3000,
    "auth": "required"
  }
}
```

Variables iniciales soportadas:

- `INKSCAPE_MCP_TRANSPORT`: `stdio` o `http`.
- `INKSCAPE_MCP_WORKSPACE_ROOTS`: array JSON de strings; no una lista separada por `;`.
- `INKSCAPE_MCP_SCRATCH_ROOT`.
- `INKSCAPE_BIN`.
- `INKSCAPE_MCP_MAX_CONCURRENCY`.
- `INKSCAPE_MCP_PROCESS_TIMEOUT_MS`.
- `INKSCAPE_MCP_HTTP_PORT`.

Flags iniciales soportados: `--config`, `--transport`, `--workspace-root` (repetible), `--scratch-root`, `--inkscape-bin`, `--max-concurrency`, `--timeout-ms` y `--http-port`.

El archivo de configuración no contiene token HTTP. Cuando HTTP exista en F10, el bearer token se inyectará desde un secret/entorno de arranque y se redactará de logs y resultados.
