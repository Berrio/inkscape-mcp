# Configurar clientes MCP en Windows

Esta guía configura el servidor persistente por stdio. No uses los subcomandos
`inkscape-mcp export` o `inkscape-mcp run` como comando MCP: terminan después de
su trabajo; un cliente MCP debe lanzar `dist/cli.js` sin subcomando.

## Antes de añadirlo

Desde el repositorio, prepara y comprueba el binario:

```powershell
npm ci
npm run check
node .\dist\cli.js --doctor --json
```

Escoge un workspace privado que contenga sólo diseños y assets confiables. La
ruta del workspace sí puede ser absoluta en la configuración del cliente porque
es configuración local del operador; las tools MCP deben seguir recibiendo
rutas **relativas** a ese workspace.

La comprobación de protocolo del release es:

```powershell
npm run test:mcp
npm run test:pack
```

## Codex CLI

Esta sintaxis fue comprobada con `codex-cli 0.146.0` instalado localmente. Añade
un servidor stdio mediante:

```powershell
codex mcp add inkscape-mcp -- node `
  "C:\ruta\a\InKscape-MCP\dist\cli.js" `
  --workspace-root "C:\disenos"
```

Inspecciona o elimina la configuración con:

```powershell
codex mcp get inkscape-mcp
codex mcp list
codex mcp remove inkscape-mcp
```

El comando `add` modifica la configuración de Codex del usuario; no lo ejecutes
desde una receta ni lo incluyas en el Programador de tareas. Para varias
carpetas autorizadas, añade más pares `--workspace-root <ruta>` en el mismo
comando.

## Visual Studio Code

VS Code 1.132.1 está presente en el baseline de esta guía. Su
[referencia oficial de configuración MCP](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
define servidores stdio bajo la clave `servers`. Crea
`.vscode/mcp.json` en el workspace de desarrollo del repositorio MCP o abre
`MCP: Open User Configuration` para una configuración del perfil.

La plantilla versionada
[examples/vscode-mcp.json](./examples/vscode-mcp.json) es JSON válido para ese
formato. Sustituye `C:\ruta\a\InKscape-MCP` por la ubicación real del
repositorio:

```json
{
  "servers": {
    "inkscape-mcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:\\ruta\\a\\InKscape-MCP\\dist\\cli.js",
        "--workspace-root",
        "${workspaceFolder}"
      ]
    }
  }
}
```

`${workspaceFolder}` se resuelve por VS Code antes de lanzar Node. Abre la vista
MCP y arranca el servidor; después llama `inkscape_status` y `workspace_list`.
No actives sandboxing de VS Code esperando aislar Inkscape en Windows: la
documentación oficial indica que esa opción sólo está disponible en macOS y
Linux. Mantén por tanto `trusted-local-only` y un workspace privado.

## Otros clientes stdio

El contrato mínimo es siempre el mismo:

| Campo                 | Valor                                                            |
| --------------------- | ---------------------------------------------------------------- |
| Ejecutable            | `node`                                                           |
| Primer argumento      | Ruta absoluta local a `dist/cli.js`                              |
| Arguments posteriores | Uno o más pares `--workspace-root` y su ruta absoluta            |
| Directorio de trabajo | El repositorio MCP o cualquier directorio local legible          |
| stdout                | Exclusivamente framing MCP/JSON-RPC; nunca lo redirijas a un log |
| stderr                | Diagnóstico del servidor y de Inkscape                           |

El formato del archivo de configuración cambia por cliente. Copia sólo esos
valores al esquema documentado por tu cliente; no agregues `--transport http`,
rutas de ejecutable de Inkscape ni comandos shell a una tool MCP. Después de
configurarlo, usa `inkscape_status` y una exportación de prueba en un workspace
temporal antes de apuntarlo a diseños reales.

## Evidencia y alcance

La sintaxis de Codex se verificó con `codex mcp add --help` y `codex mcp list`,
sin escribir la configuración global. La plantilla VS Code se validó como JSON
y se contrastó con la referencia oficial citada arriba; el servidor se prueba
end-to-end por el cliente MCP SDK del repositorio en modos moderno y legacy.
No se afirma que clientes no listados ni versiones futuras mantengan el mismo
schema: consulta la [matriz de compatibilidad](./compatibility-matrix.md) y la
documentación del cliente antes de actualizar.
