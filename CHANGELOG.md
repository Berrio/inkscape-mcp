# Changelog

Este proyecto sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y usa versionado semántico cuando publique versiones.

## [Unreleased]

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
- El runner resuelve `taskkill.exe` desde el directorio del sistema, comprueba
  su resultado, mata grupos de procesos en POSIX y no queda bloqueado si un
  descendiente escapado mantiene abiertos los pipes.
- HTTP: rate limit por principal y cupo separado para intentos no
  autenticados; caché del archivo de tokens y corte de streams SSE cuando el
  cliente se desconecta.
- Rutas que Windows reinterpreta (`CON`, `NUL.svg`, `out.svg.`) se rechazan.
- SDK MCP 2.3.1 e Inspector 2.9.0: `npm audit` sin vulnerabilidades.

- Windows: cada proceso nativo corre en un Job Object con kill-on-close desde
  su lanzamiento (ADR-012, dependencia `koffi`). Los descendientes desacoplados
  y el árbol de un servidor que muere abruptamente ya no quedan huérfanos;
  `--doctor` informa `processContainment`.

### Fixed

- Un ejecutable inexistente ya no provoca una excepción no capturada en el
  runner.

### Changed

- Las ediciones in-place conservan los 10 backups más recientes por documento.
- Los locks de publicación se coordinan entre procesos locales.
- Cuota de artifacts (1.000 vivos, 4 × `maxArtifactBytes`) y limpieza de copias
  huérfanas de ejecuciones anteriores.
- El probe de capacidades reintenta fallos transitorios y no cachea fallos.
- El listado de documentos está limitado a 100.000 entradas y 32 niveles.

## [0.1.0] - 2026-08-27

### Added

- Servidor MCP local por `stdio` para Inkscape headless, con 68 tools de
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
