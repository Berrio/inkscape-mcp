# ADR-014: extensión compañera para operaciones GUI-only (diseño, deshabilitada)

## Estado

Diseño aceptado el 2026-10-07 (F12-T03/T04/T05). **No implementado y deshabilitado:** ninguna tool, opción de configuración ni proceso del servidor lo activa.

## Contexto

El núcleo es headless (ADR-002): DOM SVG seguro más acciones CLI allowlisted. Algunas operaciones de Inkscape sólo existen con un escritorio y un documento abierto:

- edición interactiva con selección visual;
- algunos efectos que dependen del canvas;
- diálogos de extensiones con estado de la UI.

El plan prohíbe depender de una ventana activa o de la automatización por coordenadas.

## Diseño (F12-T03)

- Una **extensión Inkscape** (`.inx` + script) instalada por el usuario en su perfil, nunca por el servidor. Se ejecuta dentro del proceso GUI que el usuario abrió.
- La extensión no recibe órdenes libres. Expone un **catálogo cerrado de operaciones GUI-only**, cada una con schema estricto equivalente al de las tools. No hay shell, `argv`, IDs de extensión arbitrarios ni ejecución de acciones por nombre.
- Trabaja sobre el **documento abierto**, nunca sobre rutas de archivo aportadas por el cliente. El resultado vuelve al workspace por el flujo normal: revisión, staging y commit atómico (ADR-005) cuando el usuario guarda o exporta.
- Las operaciones que tienen equivalente headless no se ofrecen por el puente.

## Handshake y versionado (F12-T04)

1. El servidor crea un **canal local por sesión**: un named pipe de Windows con ACL del usuario actual y un nombre aleatorio de 128 bits. No usa sockets TCP.
2. El usuario lanza la extensión desde la GUI. La extensión lee el nombre del pipe y un **token de un solo uso** de un archivo de su perfil. El servidor escribe ese archivo con permisos exclusivos y lo rota en cada sesión.
3. Primer mensaje de la extensión: `{ protocol: "inkscape-mcp-gui/1", inkscapeVersion, extensionVersion, operations: [...] }`.
4. El servidor acepta sólo si se cumplen todas estas condiciones:
   - la versión del protocolo coincide;
   - `inkscapeVersion` está en la política de versión (1.4.4 estable; 1.5+ experimental);
   - el catálogo anunciado está contenido en el allowlist del servidor.

   Si algo no cuadra, cierra el canal con un error estable y sin datos del documento.

5. Cada petición lleva un ID, deadline y cancelación. La respuesta contiene sólo datos estructurados acotados; los artefactos grandes pasan por el almacén de artifacts.
6. Versionado semántico del protocolo. Un cambio incompatible incrementa `/N`, y el servidor puede soportar como máximo dos versiones a la vez.

## Deshabilitado por defecto y permisos separados (F12-T05)

- El puente no existe en el catálogo: el schema estricto de configuración (`configInputSchema`) no tiene ninguna opción GUI y rechaza claves desconocidas, y no hay tool ni proceso asociados.
- Si se implementa, exigirá **las tres** condiciones siguientes:
  - opción de arranque explícita del operador (`gui.enabled: true`), nunca activable desde una tool;
  - un **permiso separado** por principal en HTTP (`gui` además de `mcp`);
  - aviso en `--doctor` e `inkscape_status` de que el puente opera sobre una sesión interactiva del usuario.
- El puente no amplía roots, no lee archivos fuera del workspace y no cambia `nativeInputPolicy`.

## Riesgos (threat model)

- Un proceso local que suplante a la extensión: lo mitigan la ACL del pipe y el token de un solo uso.
- Una operación que modifique el documento sin revisión: sólo se persiste mediante commit con `expectedRevision`.
- Extensiones de terceros cargadas en el mismo Inkscape: fuera del control del servidor; se documentará como riesgo residual.

## Consecuencias

1.0 sigue siendo totalmente headless. Antes de publicar el puente habrá que cumplir F12-G01: implementación, tests de handshake y rechazo, capability gate y documentación.
