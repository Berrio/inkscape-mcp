# Instrucciones para agentes de implementación

Este repositorio se rige por [PLAN_IMPLEMENTACION.md](./PLAN_IMPLEMENTACION.md). El plan es la fuente de verdad de alcance, orden, seguridad, contratos, pruebas y definición de terminado.

## Antes de trabajar

1. Lee completo este archivo y `PLAN_IMPLEMENTACION.md`.
2. Inspecciona `git status`, la fase/WP activos y `docs/progress/`.
3. Identifica un único work package `FXX-WPYY` de la fase autorizada.
4. Confirma que sus dependencias y mini-puertas anteriores están cerradas.
5. Inspecciona los archivos existentes antes de editarlos y conserva cambios ajenos.

Si el usuario autoriza implementar/continuar pero no indica fase o WP, ejecuta únicamente el siguiente WP incompleto siguiendo el orden lógico de la sección 21 del plan (F10 es opcional para 1.0). Si solo pide revisar o planificar, no implementes. Nunca ejecutes varios WP en una sola sesión por iniciativa propia.

## Forma de ejecución

- Trabaja únicamente en el WP solicitado.
- Usa los IDs `FXX-TYY` como unidades de trabajo.
- No adelantes APIs, refactors o features de WP/fases posteriores.
- Haz cambios pequeños, verificables y coherentes con los ADRs.
- Usa `rg`/`rg --files` para buscar y `apply_patch` para editar manualmente.
- No marques `[x]` al escribir código. Ejecuta primero la verificación y registra evidencia.
- Actualiza la subsección del WP en `docs/progress/FXX.md` y las casillas del plan al finalizar.
- No hagas commit, tag, publicación, instalación de software del sistema ni cambios externos salvo autorización explícita.
- No modifiques configuración global de Git, npm, Node, Inkscape o el sistema.

## Invariantes de seguridad

- Ninguna tool pública acepta shell, comando, argumentos CLI, acciones Inkscape o extension IDs arbitrarios.
- Ninguna tool pública acepta rutas absolutas; usa rutas relativas o IDs/URIs opacos.
- Toda ruta de documento/asset/output aportada por el cliente pasa por roots canónicos y el resolver seguro.
- Ejecutable/datos/extensiones/fuentes del sistema se descubren solo desde configuración de arranque/proveedores internos confiables y son read-only; nunca se convierten en paths públicos de tools.
- Scratch y temporales usan ubicaciones creadas/controladas por el servidor con límites y limpieza; no amplían los roots visibles al cliente.
- Todo proceso pasa por el runner único con `shell: false`, timeout, aborto, límites separados y limpieza; en Windows se termina el árbol completo mediante Job Object/equivalente, no solo el PID padre.
- Toda invocación nativa usa un `NativeInputBundle` inmutable en staging con hashes/refs locales reescritas y revalidación antes de publicar.
- Toda mutación de documento usa lock, `expectedRevision` obligatorio, staging, validación y commit atómico.
- Toda sobrescritura de output usa lock y `expectedOutputRevision`; un output nuevo falla si ya existe.
- `overwrite` es `false` por defecto; una edición in-place exige backup/política explícita.
- SVG/XML se considera no confiable: sin DTD/XXE, scripts ni recursos remotos por defecto. Una tool solo puede pedir un `sanitizeMode` igual o más restrictivo que el máximo de confianza configurado al arrancar; nunca puede elegir `trusted` por sí misma.
- La versión 1.0 no promete contener exploits desconocidos de Inkscape/Poppler/codecs. Sin sandbox reforzado, solo envía a parsers nativos archivos de origen local confiable y declara esa limitación en doctor/status/docs.
- Artefactos grandes se leen por links/chunks autorizados y acotados; no se cargan completos en memoria ni se envían completos por stdio.
- En stdio, stdout se reserva exclusivamente para MCP; logs a stderr.
- No publiques paths absolutos, contenido de documentos, secretos o variables de entorno en logs/resultados.
- Una capability ausente devuelve un error recuperable; nunca se simula éxito.
- Si HTTP está activo, bearer auth es obligatorio incluso en loopback, además de validar Host/Origin.

## Invariantes de arquitectura

- La capa MCP no toca XML, filesystem ni `argv` directamente.
- El dominio no depende del transporte MCP.
- El adaptador Inkscape no decide políticas de producto.
- La infraestructura no contiene lógica de diseño.
- El catálogo de tools es estable y determinista.
- Usa `@modelcontextprotocol/server` v2 y Zod v4 según las versiones fijadas por F00.
- El backend principal es headless e híbrido: DOM SVG seguro + CLI/actions allowlisted.
- No dependas de una ventana activa ni de automatización por coordenadas.
- Inkscape 1.4.4 es el baseline inicial; 1.5+ queda gateado hasta el adaptador correspondiente.

## Calidad mínima por cambio

Para cada tarea implementada:

- schema estricto con límites y propiedades desconocidas rechazadas;
- tipos y errores estables;
- tests positivos, negativos y de límites;
- prueba de seguridad si toca paths, XML, procesos, outputs o HTTP;
- cancelación/timeout/cleanup si realiza IO largo;
- documentación del contrato y limitaciones;
- `npm run check` exitoso antes de cerrar el WP, una vez que ese script exista.

Una tarea solo se cierra como `[x]`, `[-]` con evidencia de capability no anunciada, o `[w]` con decisión explícita del usuario; nunca se omite silenciosamente.

No reduzcas tests, límites ni validación para lograr una puerta verde. Si una prueba demuestra que el plan necesita cambiar, documenta la evidencia y propone el cambio antes de alterar un contrato público.

## Bloqueos que requieren al usuario

Detente y pide decisión si hace falta:

- escoger licencia o nombre público;
- instalar/cambiar software del sistema;
- acceder fuera de los roots autorizados;
- habilitar HTTP remoto o ampliar permisos;
- introducir un formato/contrato público incompatible;
- publicar en npm/MCP Registry, crear tags o releases;
- redistribuir fuentes/assets de licencia incierta;
- cambiar el alcance de la fase.

Una limitación técnica no autoriza un escape inseguro.

## Informe de cierre de fase

Incluye de forma concisa:

1. resultado alcanzado;
2. tareas y puertas marcadas;
3. archivos modificados;
4. comandos de verificación y resultado;
5. decisiones/desviaciones;
6. riesgos/deuda restante;
7. siguiente WP recomendado, sin ejecutarlo.
