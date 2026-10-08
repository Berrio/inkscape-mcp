# Changelog

Este proyecto sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y usa versionado semántico cuando publique versiones.

## [Unreleased]

### Fixed

- Locks entre procesos: el poseedor renueva el lock con un heartbeat, así que
  una operación larga (batch de muchos minutos) ya no puede perder su lock
  frente a otro proceso. La recuperación de locks abandonados se serializa con
  un guard exclusivo y ya no puede borrar el lock recién creado por otro
  contendiente; el estado _delete-pending_ de Windows (`EPERM`) se trata como
  ocupado transitorio.
- Artifacts: si el hash de una copia falla, la copia se elimina en vez de
  quedar huérfana hasta el barrido de 24 h.
- Runner: un proceso que termina normalmente dejando un descendiente con los
  pipes abiertos (modo sin Job Object) se informa como completado con su
  código de salida, en lugar de esperar al timeout y reportarlo como tal.

## [0.1.0] - 2026-10-07

Primera versión publicada (tag `v0.1.0` en GitHub). La publicación en npm y en el MCP Registry queda pendiente.

### Added

- Servidor MCP local por `stdio` para Inkscape headless, con 90 tools de
  documento, diseño vectorial, recursos, imágenes, importación y exportación.
- Workspaces autorizados, revisiones SHA-256, locks, staging y publicación
  atómica para evitar rutas libres y sobrescrituras accidentales.
- Flujos autónomos de exportación y recetas, junto con scripts PowerShell para
  automatización Windows no interactiva.
- Hardening reproducible: corpus adversarial, límites de carga y concurrencia,
  recuperación de staging obsoleto, auditoría de dependencias y revisión de
  logs/superficie de seguridad.
- Metadatos de paquete y `server.json` coherentes para la publicación de npm
  y del registro MCP.
- `document_export` exporta la paleta de colores GIMP (`.gpl`) mediante el
  adapter fijo `inkscape-gpl/v1` (sólo área `drawing`, con acknowledgement de
  fidelidad limitada).
- `npm run test:installed`: ejecuta todas las puertas end-to-end, el Inspector
  y los scripts PowerShell contra el paquete empaquetado e instalado.

### Security

- El saneamiento SVG clasifica las referencias por namespace: un prefijo XLink
  alternativo (`xl:href`) ya no permite que Inkscape incruste archivos externos
  al workspace en una exportación. La copia staged elimina `sodipodi:absref`.
- Se eliminan processing instructions, `xml:base`, animaciones SMIL con
  referencias prohibidas, referencias UNC y CSS ofuscado con escapes.
- Los errores devueltos por MCP (tools, recursos y jobs) ya no incluyen rutas
  absolutas; los errores del sistema de archivos usan textos estables con su
  código.
- `maxInputBytes` y `maximumSanitizeMode` se aplican a todas las tools, y los
  documentos se leen con un límite de tamaño previo a la carga.
- Windows: cada proceso nativo corre en un Job Object con kill-on-close desde
  su lanzamiento (ADR-012, dependencia `koffi`). Los descendientes desacoplados
  y el árbol de un servidor que muere abruptamente ya no quedan huérfanos;
  `--doctor` informa `processContainment`.
- El runner resuelve `taskkill.exe` desde el directorio del sistema, comprueba
  su resultado, mata grupos de procesos en POSIX y no queda bloqueado si un
  descendiente escapado mantiene abiertos los pipes.
- HTTP: rate limit por principal y cupo separado para intentos no
  autenticados; caché del archivo de tokens y corte de streams SSE cuando el
  cliente se desconecta.
- Rutas que Windows reinterpreta (`CON`, `NUL.svg`, `out.svg.`) se rechazan.
- SDK MCP 2.3.1 e Inspector 2.9.0: `npm audit` sin vulnerabilidades.

### Fixed

- La consulta de capacidades ya no lee y hashea el binario de Inkscape entero
  en cada llamada: el hash se memoriza por ruta, tamaño y `mtime` y se calcula
  por streaming.
- La suite de tests ya no falla de forma intermitente en máquinas cargadas:
  timeout de 20 s para los tests que lanzan procesos reales.
- Un ejecutable inexistente ya no provoca una excepción no capturada en el
  runner.
- `document_export_batch` rechaza al validar, con un mensaje que remite a
  `document_export`, los formatos que su renderizador no produce (DXF, HPGL,
  FXG, SIF, GPL, PS/EPS, EMF/WMF); antes fallaban tarde con un error genérico.
- El verificador GPL ya no exige la cabecera opcional `Columns:`, que
  Inkscape 1.4.4 no emite; la sonda de doctor deja de marcar GPL como no
  disponible.

### Changed

- Las ediciones in-place conservan los 10 backups más recientes por documento.
- Los locks de publicación se coordinan entre procesos locales.
- Cuota de artifacts (1.000 vivos, 4 × `maxArtifactBytes`) y limpieza de copias
  huérfanas de ejecuciones anteriores.
- El probe de capacidades reintenta fallos transitorios y no cachea fallos.
- El listado de documentos está limitado a 100.000 entradas y 32 niveles.
