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
- `INKSCAPE_MCP_HTTP_TOKEN`: obligatorio sólo con `transport: "http"`; debe
  ser un token base64url de al menos 32 caracteres. No se admite en JSON ni
  flags, para que no termine versionado o expuesto por argumentos de proceso.

Flags iniciales soportados: `--config`, `--transport`, `--workspace-root` (repetible), `--scratch-root`, `--inkscape-bin`, `--max-concurrency`, `--timeout-ms` y `--http-port`.

El archivo de configuración no contiene token HTTP. El transporte HTTP es
opt-in experimental: escucha exclusivamente `127.0.0.1`, publica sólo `/mcp`,
exige `Authorization: Bearer …`, valida Host/Origin, limita cuerpo por
`maxInputBytes` y aplica 120 requests/minuto en loopback. Genera el secreto
fuera del repositorio, por ejemplo en PowerShell:

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:INKSCAPE_MCP_HTTP_TOKEN = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
node dist/cli.js --transport http --http-port 3000 --workspace-root C:\disenos
```

La rotación se hace sustituyendo esa variable y reiniciando el proceso local.
Nunca copies el token en logs, recetas, documentos ni configuración de cliente.
