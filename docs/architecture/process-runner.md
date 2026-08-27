# Runner de procesos nativos

`ProcessRunner` es la única capa que podrá lanzar Inkscape. Recibe un ejecutable resuelto por discovery y un array de argumentos ya validado; nunca recibe una cadena de shell ni argumentos públicos sin validar.

## Garantías actuales

- `spawn(executable, argv, { shell: false, windowsHide: true })`.
- CWD requerido y entorno mínimo allowlisted, con overrides explícitos.
- Semaphore global configurable.
- Captura independiente de stdout y stderr con límite de bytes; un flood se drena, se clasifica como `output-limit` y termina el proceso.
- Timeout y `AbortSignal`.
- Tracking de PID, timers, listeners y slot de semaphore limpiados en `finally`/cierre.
- En Windows, el terminador invoca `taskkill.exe /pid <pid> /t /f` para el árbol cuyo PID creó el runner. La suite verifica padre e hijo real.
- En otros sistemas, intenta SIGTERM y escala a SIGKILL después de 250 ms.

## Límite conocido

`taskkill /T` es el terminador de árbol disponible sin addon nativo y cubre descendientes normales. Un proceso que se desacople deliberadamente del árbol requiere un helper con Windows Job Object/aislamiento adicional; esa amenaza queda documentada para el hardening posterior. Las tools nunca controlan el PID ni el comando que se termina.

Al arrancar por stdio, el CLI también elimina únicamente directorios scratch
`inkscape-mcp-*` propios cuya antigüedad supera 24 horas. No intenta terminar
PIDs que encuentre en un reinicio: sin un Job Object o una identidad de proceso
verificable, hacerlo podría matar un proceso ajeno por reutilización de PID.
