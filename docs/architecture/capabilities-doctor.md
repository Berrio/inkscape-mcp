# Capabilities y doctor

`inkscape-mcp --doctor` se puede ejecutar sin workspace. Descubre y valida una
instalación local, consulta `--help-all`, `--list-input-types` y `--action-list`,
y realiza una exportación PNG mínima en un directorio temporal controlado.

El snapshot se cachea cinco minutos y su huella depende del hash SHA-256,
tamaño, mtime y versión del ejecutable, más el estado de perfil, data dirs,
directorio de extensiones y helpers. El servicio admite rutas adicionales para
adaptadores futuros; el contexto por defecto usa el perfil de Inkscape, el
directorio del ejecutable y Node como helper. Cualquier cambio invalida la clave.

Las acciones listadas son evidencia observada: se representan con origen
`unknown` y nunca se infiere que sean core, extensión o headless seguras. Los
flags de exportación rastreados distinguen `available` de `absent`; la lista de
capabilities `experimental` se mantiene separada y vacía hasta que haya una
sonda que la respalde.

El doctor no expone paths absolutos. Conserva el stderr nativo observado y no
silencia warnings GTK desconocidos. En la instalación MSIX local de referencia
1.4.4 se observaron 189 acciones, 55 input types y 69 opciones; por tanto la
puerta histórica de ≥1000 acciones no se puede declarar satisfecha.
