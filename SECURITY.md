# Política de seguridad

## Estado actual

El servidor MCP local por stdio ya es ejecutable para workspaces configurados,
pero su nivel actual es `workspace-guarded-native-unsandboxed`. Protege la
estructura de rutas, argumentos, XML/SVG, revisiones, temporales y publicación
de artefactos; no aísla vulnerabilidades desconocidas de Inkscape, Poppler,
códecs u otros parsers nativos.

No proceses archivos de origen no confiable. El baseline exige
`nativeInputPolicy: trusted-local-only`, informa `nativeParserIsolation: none`
en `--doctor --json` e `inkscape_status`, y no usa la palabra "sandbox" para
describir Job Objects, timeouts, sanitización o staging. Un sandbox de SO para
inputs no confiables es trabajo posterior y no está disponible hoy.

## Reportar una vulnerabilidad

No publiques detalles explotables en una issue pública. Cuando el repositorio esté disponible en GitHub, usa la función de _private vulnerability reporting_ si está habilitada. Si no lo está, contacta al mantenedor mediante su perfil de GitHub y proporciona una descripción mínima, versión afectada y pasos de reproducción seguros.

## Límites de la versión actual

Los roots deben ser directorios privados del usuario que ejecuta el servidor;
no uses workspaces compartidos o escribibles por actores locales hostiles. La
resolución canónica y los rechecks reducen traversal y cambios accidentales,
pero no garantizan resistencia frente a un proceso local con permisos que
manipule junctions/reparse points durante una operación.

Las configuraciones y resultados redactan rutas absolutas. Las tools aceptan
rutas relativas dentro del workspace, nunca shell, argv o rutas de ejecutable
arbitrarias. La red permanece denegada para recursos de documentos.
