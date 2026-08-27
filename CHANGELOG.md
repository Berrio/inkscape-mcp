# Changelog

Este proyecto sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y usa versionado semántico cuando publique versiones.

## [Unreleased]

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
- Metadatos de paquete y `server.json` coherentes para una futura publicación
  de npm y del registro MCP. El paquete permanece privado en esta versión.
