# Descubrimiento de Inkscape

El descubrimiento es interno: las tools MCP no aceptan ejecutables ni comandos.
Cada ubicación candidata se resuelve canónicamente, debe ser un archivo y se
deduplica antes de ser validada ejecutando `--app-id-tag=... --version` con el
runner seguro.

## Proveedores y orden

1. Ruta `inkscapeBin` configurada al arrancar.
2. `PATH` del proceso.
3. Ubicaciones estándar de Windows, macOS y Linux.
4. Windows App Paths y claves de desinstalación que indiquen Inkscape.
5. Paquetes AppX/MSIX de Windows mediante `Get-AppxPackage` y su
   `InstallLocation` observado.

Las rutas MSIX se derivan desde `InstallLocation`; no se codifica una versión ni
un nombre de directorio de paquete. Para Inkscape 1.4.4 se prueba, entre otras,
la ruta relativa `VFS/ProgramFilesX64/Inkscape/bin/inkscape.exe`.

Una entrada inexistente de `PATH` no se añade al diagnóstico: `PATH` suele
contener decenas de directorios ajenos. Sí se conserva evidencia de rutas
configuradas, estándar, registro y MSIX que no se puedan resolver.

## Validación

- `--version` debe terminar normalmente, sin salida truncada y con código 0.
- La salida debe contener una versión `Inkscape X.Y` reconocible.
- Los errores de ejecución se convierten en rechazos diagnósticos, no interrumpen
  la búsqueda de las demás instalaciones.
- Las rutas absolutas quedan dentro de infraestructura; las capas MCP posteriores
  las redactarán en resultados y logs.

La prueba `tests/integration/discovery-msix.test.ts` se activa solo con
`RUN_INKSCAPE_INTEGRATION=1` en Windows. Permite comprobar la instalación local
sin hacer que CI requiera Inkscape.
