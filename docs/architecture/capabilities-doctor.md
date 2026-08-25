# Capabilities y doctor

`inkscape-mcp --doctor` se puede ejecutar sin workspace. Descubre y valida una
instalación local, consulta `--help-all`, `--list-input-types` y `--action-list`,
y realiza una exportación PNG mínima en un directorio temporal controlado.

El snapshot se cachea cinco minutos y su huella depende de ruta interna, tamaño,
mtime y versión del ejecutable. Las acciones listadas son evidencia observada;
su origen se considera desconocido hasta que una fase posterior lo clasifique y
no se infiere que sea una acción headless segura.

El doctor no expone paths absolutos. Conserva el stderr nativo observado y no
silencia warnings GTK desconocidos. En la instalación MSIX local de referencia
1.4.4 se observaron 189 acciones, 55 input types y 69 opciones; por tanto la
puerta histórica de ≥1000 acciones no se puede declarar satisfecha.
