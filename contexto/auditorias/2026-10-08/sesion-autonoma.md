# Sesión autónoma — 2026-10-08 (02:01, hora de Colombia)

Ejecución programada y autorizada por el usuario el 2026-10-07, sin el usuario presente. Las decisiones se tomaron según la opción recomendada y quedan registradas aquí. Límites aplicados: commits sólo locales; sin push, tags, releases ni publicaciones; sin instalar software ni cambiar configuración global.

## Estado inicial

- Árbol de trabajo limpio en `fa6ceb3`. `origin/main` seguía en `5cc6498`: los 11 commits del 2026-10-07 no están subidos.
- **Pendiente de la sesión anterior:** el usuario autorizó publicar en GitHub (push, tag `v0.1.0` y GitHub Release). La sesión se cortó después de generar los artefactos en `artifacts/releases/v0.1.0/` (de `fa6ceb3`, árbol limpio) y antes del push. Esta ejecución tiene prohibido publicar, así que **la publicación sigue pendiente** (ver «Requiere al usuario»).

## 1. Fallos intermitentes de la suite (prioridad 1)

**Causa raíz.** Ya estaba corregida en `fa6ceb3` y se confirmó en esta sesión:

- `capabilityFingerprint` leía y hasheaba el ejecutable entero en cada `inspect()`, aunque acertara la caché. En los tests el ejecutable es `node.exe`, unos 85 MB, y el test de reintento tardaba 5.057 ms bajo carga; ahora tarda 5 ms.
- Los tests que lanzan procesos reales dependían del timeout de 5 s de vitest, y cada arranque de proceso cuesta más en una máquina cargada (más aún en Windows, por el lanzador del Job Object).

Descartado:

- procesos residuales: no había ninguno;
- el probe del lanzador: corre una sola vez por proceso.

**Evidencia.**

- `npm run check` y tres ejecuciones completas seguidas de la suite en verde, con CPU baja.
- Tras los arreglos de esta sesión, `npm run check` y otras dos ejecuciones también en verde (354 pruebas).
- El test más lento (5,9 s) es el deadline de 5 s esperado por diseño, muy por debajo del timeout de 20 s.

## 2. Bugs encontrados y corregidos

Revisión del código cambiado desde `5cc6498`.

| Commit    | Bug                                                                                                                                                                                               | Corrección                                                                                                                | Test                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `864618e` | **Robo de un lock vivo:** un lock entre procesos se declaraba abandonado a los 10 min aunque su PID viviera. Un batch largo podía perderlo y otro proceso publicaría a la vez.                    | Heartbeat del poseedor (cada 15 s). Abandonado = PID muerto o heartbeat de más de 60 s; también cubre un PID reutilizado. | Un poseedor que late no se roba; un PID vivo sin latido sí se recupera. |
| `864618e` | **Recuperación concurrente:** dos procesos podían recuperar el mismo lock abandonado y el segundo borraba el lock recién creado por el primero (el test llegó a 3 contendientes dentro a la vez). | Guard exclusivo `<lock>.reclaim` con relectura del token dentro de él.                                                    | 6 contendientes: nunca más de uno dentro; 0 fallos en 40 repeticiones.  |
| `864618e` | **Windows _delete-pending_:** recrear un lock recién borrado devolvía `EPERM` y la operación fallaba.                                                                                             | Se trata como ocupado transitorio con backoff; al vencer el plazo se devuelve el error real.                              | Cubierto por el test de concurrencia (antes fallaba 1 de cada 20).      |
| `f906970` | **Salida normal mal informada:** sin Job Object, un proceso que terminaba normalmente dejando un descendiente con los pipes abiertos esperaba al timeout y se informaba como `timeout`.           | Tras `exit`, máximo 2 s de espera a `close`; después se informa el código real como `completed`.                          | ~2 s con código 0 en vez de 15 s y `timeout`.                           |

## 3. Hallazgos no corregidos (baja prioridad)

- `ArtifactStore.copyAndRecord`: si el hash fallara después de copiar, la copia quedaría en el directorio de artifacts sin registrar hasta el barrido de huérfanos (24 h). No se pudo provocar de forma determinista para darle un test, y la regla es «cada corrección con su test», así que se deja anotado. El impacto está acotado por el barrido de huérfanos.
- Tras `exit`, el runner espera 2 s a que se vacíen los pipes. Un volcado de salida que siguiera llegando más de 2 s después de que el proceso terminara se truncaría. No se observó (los pipes se vacían en milisegundos) y los límites de salida son de pocos MB.

## 4. Decisiones tomadas (opción recomendada)

- Los arreglos de hoy se registran en `## [Unreleased]` del CHANGELOG, no en `[0.1.0]`. Así los artefactos ya generados para `fa6ceb3` siguen siendo un candidato `v0.1.0` válido; los arreglos quedan para `0.1.1` o para un nuevo candidato si el usuario prefiere taguear `HEAD`.
- No se modificó ningún contrato público ni el fingerprint de tools.

## 5. Verificación E2E

`npm run test:installed` en `f906970` (empaqueta, instala el `.tgz` y ejecuta contra el binario instalado, con Inkscape 1.4.4 MSIX y el Job Object activo): **27/27 puertas en verde**, incluidas `test:mcp` (P0/P1 moderno y legacy), el Inspector stdio, la cancelación/recuperación de F05 y la automatización Windows. Antes de los arreglos, `test:mcp` sobre `fa6ceb3` también pasó.

## 6. Requiere al usuario

1. **Publicación en GitHub autorizada el 2026-10-07 y no completada.** Dos caminos:
   - **Recomendado (`v0.1.1` con los arreglos):** `git push origin main`; actualizar la versión a `0.1.1` (CHANGELOG, `package.json`, `server.json` y el test de metadata); regenerar con `npm run release:provenance`; taguear y crear la release.
   - **Sólo `v0.1.0`:** taguear `fa6ceb3` y adjuntar `artifacts/releases/v0.1.0/`.
2. **npm y MCP Registry** (`F11-T23/T24`): siguen diferidos hasta que el usuario ejecute `npm login`.

## Resumen

La suite es estable: la causa raíz quedó confirmada y hubo tres o más ejecuciones seguidas en verde. Se corrigieron cuatro bugs reales de concurrencia y procesos, todos con tests, en dos commits locales (`864618e` y `f906970`). Además se registró la evidencia en `docs/progress/F01.md` y `F02.md`. No se publicó nada. Lo único que necesita al usuario es completar la publicación en GitHub (y, más adelante, npm).
