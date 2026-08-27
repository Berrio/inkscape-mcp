# Inkscape en Windows: MSIX, instalador y diagnóstico

`inkscape-mcp` no necesita que `inkscape.exe` esté en `PATH`, y las tools MCP
nunca aceptan una ruta de ejecutable. La detección ocurre al arrancar, dentro
de la infraestructura confiable, y valida cada candidato con `--version` antes
de usarlo.

Ejecuta primero:

```powershell
node .\dist\cli.js --doctor --json
```

En el resultado busca `inkscape.version`, `inkscape.installKind` y
`inkscape.sources`; las rutas reales se ocultan intencionadamente. La salida
de texto muestra una línea equivalente a `Inkscape: <versión> (<tipo>)`.

## Inkscape de Microsoft Store / MSIX

Las actualizaciones MSIX cambian el directorio versionado bajo `WindowsApps`.
Por eso no copies ni configures una ruta con el número de versión. El servidor
consulta el paquete instalado y construye candidatos desde su
`InstallLocation`; después los prueba normalmente. Un `installKind` de `msix`
confirma ese flujo.

No intentes solucionar la detección tomando posesión de `WindowsApps`, creando
un enlace manual ni sustituyendo ACLs. En particular, que `inkscape.com` no se
pueda ejecutar directamente no significa que el servidor deba omitir su
validación o usar otro binario no probado.

Si `--doctor` no encuentra el paquete:

1. Abre Inkscape una vez desde Inicio y comprueba que se actualizó o instaló.
2. Ejecuta de nuevo `--doctor`; la detección no conserva rutas versionadas.
3. Consulta el paquete de forma sólo lectura si necesitas evidencia:

   ```powershell
   Get-AppxPackage -Name '*Inkscape*' | Select-Object Name, Version, InstallLocation
   ```

4. Si sigue sin aparecer, usa una instalación convencional CLI-friendly.

## Instalador convencional CLI-friendly

El instalador de Inkscape normalmente se descubre por `PATH`, App Paths,
registro o ubicaciones estándar. `--doctor` puede indicar `path` o `system`
como tipo de instalación. Si una instalación válida no se detecta, el operador
puede fijar el ejecutable sólo en el arranque:

```powershell
node .\dist\cli.js --doctor --inkscape-bin "C:\Program Files\Inkscape\bin\inkscape.exe"
```

La misma configuración se usa para iniciar el servidor:

```powershell
node .\dist\cli.js `
  --inkscape-bin "C:\Program Files\Inkscape\bin\inkscape.exe" `
  --workspace-root "C:\disenos"
```

La ruta configurada es una decisión local del operador, no un parámetro de las
tools ni de las recetas. Antes de automatizar exportaciones, confirma que el
doctor reporta una versión y las capabilities necesarias. Si falta una
capability, el MCP la rechaza explícitamente en vez de simular éxito.

## Diferencias operativas y soporte

| Situación                  | MSIX                               | Instalador CLI-friendly                   |
| -------------------------- | ---------------------------------- | ----------------------------------------- |
| Ruta estable para scripts  | No; cambia al actualizar           | Generalmente sí, pero no se asume         |
| Detección recomendada      | Paquete/AppX automático            | PATH, registro, App Paths o configuración |
| Configurar ruta versionada | Nunca                              | Sólo si `--doctor` lo exige               |
| Validación final           | Siempre `--version` + capabilities | Siempre `--version` + capabilities        |

Los warnings GTK en stderr no invalidan por sí mismos una instalación: el
doctor y las exportaciones deciden por código de salida, artefacto verificado y
capabilities observadas. Guarda el JSON de `--doctor` junto a una incidencia,
pero no compartas paths absolutos, workspaces ni documentos si no son
necesarios.
