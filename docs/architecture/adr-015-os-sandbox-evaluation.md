# ADR-015: sandbox de SO/contenedor para documentos no confiables (evaluación)

## Estado

Evaluación cerrada el 2026-10-07 (F12-T06). **No se adopta en 1.0.** `nativeParserIsolation` sigue siendo `none` y `nativeInputPolicy` sigue siendo `trusted-local-only`.

## Contexto

Ni la sanitización, ni el staging, ni el Job Object (ADR-012) aíslan una vulnerabilidad de Inkscape, Poppler o de los códecs (ADR-008). Para aceptar documentos de origen no confiable haría falta que el parser nativo corriera con privilegios reducidos y sin acceso al resto del sistema.

## Opciones evaluadas en este host (Windows 11 Pro 26200)

| Opción                                       | Disponibilidad observada                                                                                                        | Evaluación                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AppContainer / token restringido** (Win32) | API del sistema; requiere crear el proceso con `CreateProcess` y atributos de seguridad, factible vía FFI (`koffi`, ya en uso). | Mejor encaje con el baseline Windows/MSIX. Inkscape MSIX necesita acceso de lectura a su paquete y al perfil de fuentes; hay que validar que arranca dentro del contenedor. Es la opción recomendada si se aborda.                                                                                                                                      |
| **Windows Sandbox**                          | `WindowsSandbox.exe` no está presente; la característica no está habilitada (consultarla requiere elevación).                   | Aislamiento fuerte (VM ligera), pero exige habilitar una característica del sistema, arranca en segundos y necesita instalar Inkscape dentro en cada sesión. No es viable como ruta por defecto.                                                                                                                                                        |
| **Contenedor Linux (Docker Desktop)**        | Docker 29.6.1 con motor `linux/amd64` vía WSL (`docker-desktop`).                                                               | Aislamiento útil (`--network none`, rootfs de sólo lectura, sólo el staging montado, `--memory`, `--pids-limit`, usuario sin privilegios). Pero ejecuta **Inkscape Linux**, otra plataforma y otro build que hoy son experimentales: habría que validarlo como plataforma propia, fijar la imagen por digest y no descargar nada en tiempo de petición. |
| **WSL directo**                              | `wsl.exe` presente.                                                                                                             | Sin un aislamiento real del sistema de archivos de Windows (`/mnt/c`); no aporta frente a las opciones anteriores.                                                                                                                                                                                                                                      |

## Decisión

- 1.0 no promete procesar documentos hostiles. Se mantiene la postura declarada en `doctor`, `inkscape_status`, `SECURITY.md` y la guía de seguridad.
- Si se aborda, la ruta recomendada es un **proveedor de aislamiento** opcional basado en AppContainer, seleccionado en la configuración de arranque:
  - el parser nativo recibe sólo el bundle de staging (ADR-005) con permisos de lectura, y un directorio de salida con permisos de escritura;
  - sin red ni acceso al perfil del usuario;
  - con el Job Object de ADR-012 y límites de memoria y CPU.
- Sólo con ese proveedor activo y verificado podría existir una política `nativeInputPolicy: "sandboxed-untrusted"`. Su probe tendría que demostrar que el proceso no puede leer fuera del staging antes de anunciarla.
- El contenedor Linux queda como alternativa para despliegues Linux, sujeto a la validación de plataforma de F10.

## Condiciones antes de publicar (F12-G01)

- Prueba negativa: el proceso aislado no puede leer un archivo sentinela fuera del staging, ni abrir red.
- Suite E2E completa dentro del proveedor, con la misma fidelidad visual.
- `doctor` informa del proveedor y degrada de forma explícita a `trusted-local-only` si falla.
