# Runner de procesos nativos

`ProcessRunner` es la única capa que podrá lanzar Inkscape. Recibe un ejecutable resuelto por discovery y un array de argumentos ya validado; nunca recibe una cadena de shell ni argumentos públicos sin validar.

## Garantías actuales

- `spawn(executable, argv, { shell: false, windowsHide: true })`.
- CWD requerido y entorno mínimo allowlisted, con overrides explícitos.
- Semaphore global configurable.
- Captura independiente de stdout y stderr con límite de bytes; un flood se drena, se clasifica como `output-limit` y termina el proceso.
- Timeout y `AbortSignal`.
- Tracking de PID, timers, listeners y slot de semaphore limpiados en `finally`/cierre.
- Un ejecutable inexistente se rechaza como `ProcessSpawnError`, sin excepción no capturada.
- Tras terminar un árbol, el runner espera como máximo 5 s el cierre de stdio. Si un descendiente mantiene los pipes abiertos, los destruye y libera el slot.

## Confinamiento del árbol en Windows: Job Object

En Windows, cada ejecutable absoluto existente se lanza a través de `job-launcher.js` (`node job-launcher.js -- <exe> [...argv]`):

1. El lanzador crea un Job Object con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, sin permiso de breakaway, y se asigna a sí mismo **antes** de lanzar el ejecutable.
2. Lanza el ejecutable con `detached: true`, para quedar fuera del job de libuv, que permite _silent breakaway_. Así el ejecutable y todos sus descendientes son miembros del job desde su primera instrucción, aunque luego se desacoplen del árbol padre/hijo.
3. Solo el lanzador tiene el handle del job. Cuando termina por cualquier motivo, Windows cierra el handle y mata a todos los miembros del job:
   - el ejecutable acabó;
   - el runner aplicó `taskkill /T /F` por timeout, cancelación u `output-limit`;
   - el servidor desapareció: el lanzador comprueba su proceso padre cada 500 ms y sale si ya no existe.

El runner también lanza al propio lanzador con `detached` en este modo, por la misma razón del job de libuv. Las llamadas Win32 (`CreateJobObjectW`, `SetInformationJobObject`, `AssignProcessToJobObject`) se hacen con la dependencia `koffi` (FFI con binarios precompilados, MIT); no se compila ningún addon.

La primera ejecución de cada proceso servidor sondea una vez (`job-launcher.js --probe`) si el host puede crear y unirse a un job. El resultado se cachea por proceso. Si el probe falla (otra arquitectura, `koffi` no disponible, política del host), el runner vuelve al modo `process-tree` y `--doctor` lo informa como `processContainment`. Si el probe pasó pero el job falla en una ejecución concreta, el lanzador sale con código 70 **sin** lanzar el ejecutable: falla cerrado.

`taskkill.exe` se resuelve siempre desde `%SystemRoot%\System32`. Un error de `taskkill` solo se considera fallo si el proceso raíz sigue vivo: el cierre del job puede hacer desaparecer descendientes mientras `taskkill` recorre el árbol.

Coste medido: unos 65 ms adicionales por ejecución (arranque de Node del lanzador), frente a exportaciones de Inkscape de segundos.

El Job Object controla el **ciclo de vida** del árbol; no es un sandbox. No limita qué archivos lee el parser nativo ni contiene exploits (ver `securityLevel: workspace-guarded-native-unsandboxed`).

## Otros sistemas

En POSIX el hijo se lanza en su propio grupo de procesos (`detached`). La terminación envía SIGTERM al grupo, espera 250 ms y escala con SIGKILL al grupo completo.

## Recuperación tras reinicio

Al arrancar por stdio, el CLI también elimina únicamente directorios scratch
`inkscape-mcp-*` propios cuya antigüedad supera 24 horas. No intenta terminar
PIDs que encuentre en un reinicio: con el Job Object, el árbol de una ejecución
ya muere cuando muere su lanzador. Matar PIDs a ciegas podría alcanzar un
proceso ajeno por reutilización de PID.
