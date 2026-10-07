# ADR-012: Job Object de Windows mediante lanzador y FFI

- **Estado:** aceptado (2026-10-07)
- **Contexto de plan:** `F01-T07`, riesgo `R34` ("Cancelación mata solo al padre en Windows").

## Contexto

`taskkill /T /F` solo alcanza a los descendientes que siguen enlazados por PID padre. Hay procesos que escapan:

- uno que se desacopla de su árbol;
- el nieto de un hijo que ya terminó;
- un árbol nativo que queda vivo si el servidor muere sin terminar sus hijos.

La auditoría del 2026-10-07 (M-04) lo dejó como único hallazgo parcial. Node no expone Job Objects, y en esta máquina no hay herramientas de compilación nativa.

## Opciones

1. **Addon nativo con node-gyp.** Sin dependencia de terceros en runtime, pero exige instalar Visual Studio Build Tools (software del sistema) y compilar en cada instalación o publicar binarios propios.
2. **Asignar el hijo al job después de `spawn`.** Deja una ventana entre el lanzamiento y la asignación. Además, libuv mete a sus hijos en un job con _silent breakaway_, así que los nietos podrían escapar igualmente.
3. **Lanzador Node + `koffi` (elegida).** El lanzador entra en un job kill-on-close y después lanza el objetivo con `detached`. El árbol pertenece al job desde el lanzamiento.

## Decisión

Opción 3, aprobada por el usuario. `koffi` 3.3.2 se fija exacta como dependencia runtime (MIT, binarios precompilados, sin script de instalación necesario). El runner sondea el soporte una vez por proceso. Si el probe falla, usa el modo `process-tree`. Si el job falla en una ejecución concreta, el lanzador falla cerrado.

## Consecuencias

- Los descendientes desacoplados mueren con el árbol. Si el servidor muere, el árbol nativo muere en ≤ ~1 s.
- Cada ejecución en Windows cuesta unos 65 ms más.
- `--doctor --json` informa `processContainment: "job-object" | "process-tree"`.
- Nueva dependencia runtime con código nativo: se revisa en `docs/dependency-audit.md` y `npm audit`.
- No es un sandbox: no cambia `nativeParserIsolation: none` ni `securityLevel`.

## Pruebas

En `tests/unit/runner.test.ts` (Windows):

- un huérfano desacoplado que hereda stdio muere al terminar la ejecución;
- un servidor anfitrión (`tests/fakes/runner-host.mjs`) muerto con SIGKILL no deja hijo ni nieto vivos;
- el modo `process-tree` conserva el comportamiento anterior;
- un ejecutable inexistente sigue siendo `ProcessSpawnError`.
