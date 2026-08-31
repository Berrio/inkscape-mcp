# Plan maestro de implementación — Inkscape MCP

> Estado: **servidor MCP funcional y publicado; P0 de diseño/recursos y autonomía sin IA completado; la continuidad parte de P1**
> Fecha de la auditoría: **2026-08-25**
> Carpeta: `C:\Users\LENOVO\Documents\Repos\InKscape-MCP`
> Prioridad del producto: tamaños de documento/página y exportación fiable a PNG, PDF y SVG; después, la mayor cobertura práctica posible de diseño vectorial.
> Interpretación: donde el pedido original dice `sgv`, este plan asume `SVG`.

Navegación rápida:

- Ejecución/modelo: secciones 0–2.
- Arquitectura, seguridad y contratos: secciones 3–15.
- Checklist por fases: sección 16.
- Pruebas y escenarios de aceptación: secciones 17–18.
- Riesgos, decisiones y control final: secciones 19–25.

---

## 0. Cómo usar este documento

Este archivo es simultáneamente:

1. la especificación funcional;
2. el plan técnico;
3. el backlog ordenado;
4. la checklist de ejecución;
5. el contrato de calidad para aceptar cada fase.

Reglas de ejecución:

- Ejecutar **un solo work package (WP) por sesión**. Una fase grande se completa en varias sesiones; no adelantar trabajo de fases posteriores.
- Dentro de una fase, completar las tareas en el orden indicado salvo que una dependencia explícita justifique otro orden.
- No marcar `[x]` por haber escrito código: marcarlo únicamente después de ejecutar la verificación indicada y registrar evidencia.
- Antes de editar, leer este documento completo, `AGENTS.md`, el estado de Git y los archivos implicados.
- Mantener este documento actualizado: marcar tareas, anotar decisiones y enlazar evidencia.
- Si una capacidad depende de la versión/plataforma de Inkscape, implementarla con **detección de capacidades** y degradación explícita; no fingir soporte.
- No exponer una herramienta que acepte comandos de shell, argumentos CLI arbitrarios, acciones de Inkscape sin validar o rutas absolutas aportadas por el cliente.
- No sobrescribir un diseño por defecto. Toda mutación debe soportar revisión, copia de seguridad o escritura a un archivo nuevo.
- Detener la fase si falla su puerta de salida. Corregirla antes de continuar.

### 0.1 Cola de continuidad y autonomía sin IA

Esta cola sustituye el orden numérico de fases **para el trabajo restante**.
“Sin tokens” significa que se agotó el presupuesto del cliente de IA/Codex:
un MCP por sí solo todavía necesita un cliente que invoque tools. Por ello la
primera prioridad nueva es una interfaz local no conversacional, que reutilice
los contratos seguros ya publicados y pueda ser llamada por una persona,
PowerShell o el Programador de tareas de Windows. No se confunde con los
`planToken` efímeros de exportación, que sólo previenen repetir un plan.

Cada bloque se termina con `npm run check`, smoke real, commit/push y una
instrucción copiable en README antes de iniciar el siguiente.

| Prioridad | Estado | Funcionalidad, en este orden                                                                                                                                                                    | Corte utilizable al terminar                                                                                |
| --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P0        | `[x]`  | Mantener regresión verde y cerrar el preset preflight/token ya iniciado.                                                                                                                        | La entrega actual PNG/PDF/SVG permanece atómica y comprobada.                                               |
| P0        | `[x]`  | **CLI autónoma `export`**: un comando humano `inkscape-mcp export` para un SVG local, preset, directorio y `--dry-run`; obtiene la revisión, llama al MCP por stdio y devuelve JSON/exit code.  | Se exporta sin chat ni modelo, desde PowerShell.                                                            |
| P0        | `[x]`  | **Recetas declarativas**: `inkscape-mcp run receta.json` con schema cerrado para inspección, preflight y uno o varios exports; validación previa, manifest/recibo y códigos de salida estables. | Un lote repetible puede guardarse en Git y ejecutarse sin recordar tools MCP.                               |
| P0        | `[x]`  | **Integración Windows**: ejemplos `.ps1` y Programador de tareas, rutas con espacios, logs a fichero y modo `--non-interactive`; no GUI ni credenciales.                                        | Las exportaciones de etiquetas se programan o lanzan con una instrucción copiable.                          |
| P1        | `[x]`  | **Cola local durable**: recetas encoladas, listado, reintento explícito, cancelación y recibos; nunca publicar un resultado parcial en modo atómico.                                            | La receta/recibo sobrevive reinicios; la cancelación cooperativa termina sólo el batch atómico ya iniciado. |
| P1        | `[ ]`  | `F08-T01–T10`: completar los importadores prácticos restantes (raster, fuentes/perfiles bajo policy) con manifests y capability gates.                                                          | Materiales habituales entran de forma segura.                                                               |
| P1        | `[ ]`  | Cerrar puertas F01–F09 y release Windows/stdio: carreras, cleanup, fixtures visuales, Inspector, package smoke y documentación.                                                                 | Paquete instalable y operable sin memoria del operador.                                                     |
| P2        | `[ ]`  | Paths avanzados y formatos/extensiones no centrales: LPE, mesh, conectores, PS/EPS/EMF/WMF/XAML y optimizadores, todos gateados.                                                                | Cobertura profesional que no bloquea el flujo autónomo base.                                                |
| P3        | `[ ]`  | HTTP, matriz macOS/Linux/1.5, GUI bridge, sandbox y CMYK/PDF-X.                                                                                                                                 | Opcionales; no retrasan Windows/stdio ni la automatización local.                                           |

Regla de corte: si queda tiempo para una tarea, elegir la primera pendiente de
P0. La CLI no aceptará shell, XML ni rutas fuera del workspace; ejecutará el
propio servidor por stdio y sus schemas existentes. No mezclar en un commit una
capacidad nueva con refactors no relacionados.

### Convenciones de estado

- `[ ]`: pendiente.
- `[x]`: completado y verificado.
- `[!]`: bloqueado; añadir causa y evidencia junto a la tarea.
- `[~]`: implementado parcialmente; no cuenta para cerrar la fase.
- `[-]`: no aplicable porque la capability no se anuncia; exige evidencia y decisión registrada.
- `[w]`: waived/deferido por decisión explícita del usuario; exige razón, alcance y riesgo residual.

### Evidencia obligatoria

Cada fase debe crear `docs/progress/FXX.md`; cada WP añade una subsección fechada con:

- alcance ejecutado;
- archivos creados/modificados;
- decisiones y desviaciones respecto de este plan;
- comandos de verificación ejecutados;
- resumen de resultados y fallos;
- riesgos o deuda restante;
- commit base y `git diff --stat`; el hash final no se escribe dentro del mismo commit. Si se desea registrarlo, hacerlo en un informe/commit posterior o fuera del árbol.

No incluir secretos, rutas privadas externas al workspace ni salidas enormes en esos informes.

---

## 1. Recomendación de modelo para ejecutar el plan

### Modelo principal recomendado

Usar **`gpt-5.6-terra` con razonamiento `high`** para implementar cada fase. Es un modelo menor y más económico que el nivel frontier, pero está posicionado para equilibrar inteligencia y coste. Este proyecto nace vacío y combina protocolo MCP, XML/SVG, geometría, procesos nativos, seguridad de archivos y pruebas visuales; por eso `terra` es una elección más prudente que delegar el proyecto entero a un modelo de volumen.

Configuración sugerida:

- Fases F00–F05, F09–F12: `gpt-5.6-terra`, razonamiento `high`.
- Fases F06–F08: `gpt-5.6-terra`, razonamiento `high`; usar `xhigh` solo para geometría/path operations que no superen la puerta de calidad.
- Tareas mecánicas ya especificadas —fixtures, documentación repetitiva, tablas de presets—: se pueden delegar a **`gpt-5.6-luna`** con razonamiento `medium` o `high`, pero únicamente después de estabilizar los contratos.
- Revisión final de una fase de alto riesgo: una sesión independiente de `gpt-5.6-terra` debe revisar el diff y las pruebas antes de marcar la puerta como superada.

No pedir a un modelo menor “implementa todo el plan”. Usar este prompt por work package:

```text
Lee completos AGENTS.md y PLAN_IMPLEMENTACION.md. Ejecuta únicamente el work package
FXX-WPYY, incluidas sus pruebas focalizadas y su mini-puerta. Inspecciona antes de
editar. No avances al siguiente WP o fase. No marques ninguna casilla sin evidencia
verificable. Conserva cambios ajenos. Al terminar, actualiza docs/progress/FXX.md y
las casillas correspondientes, y resume comandos, resultados, riesgos y archivos.
```

Escalamiento:

- Si la misma puerta falla dos veces por causas de diseño, detenerse y pedir revisión de arquitectura.
- Si hay ambigüedad que cambie formatos públicos, política de sobrescritura, licencia, publicación o acceso fuera del workspace, pedir decisión al usuario.
- No “resolver” una ambigüedad de seguridad ampliando permisos.

Referencia de selección: [guía oficial de modelos GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model) y [ficha de GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

---

## 2. Auditoría inicial del entorno

### 2.1 Estado observado

- [x] La carpeta estaba vacía al iniciar la planificación.
- [x] No existe todavía repositorio Git (`.git`).
- [x] No existen código, dependencias, configuración, documentación ni assets previos.
- [x] No existe un `AGENTS.md` previo que deba conservarse.
- [x] Windows es la plataforma de desarrollo inicial.
- [x] Node.js disponible: `v24.18.0`.
- [x] npm disponible: `11.16.0`.
- [x] Git disponible: `2.55.0.windows.2`.
- [x] Python disponible: `3.13.14`; no se elige como runtime principal.
- [x] Inkscape instalado después de la primera auditoría: **Inkscape 1.4.4** (`dcaf3e7`, 2026-05-05).
- [x] Distribución de Inkscape: paquete MSIX/Microsoft Store `25415Inkscape.Inkscape`, versión de paquete `1.4.40.0`.
- [x] Ruta válida observada: `...\WindowsApps\25415Inkscape.Inkscape_1.4.40.0_x64__9waqn51p1ttv2\VFS\ProgramFilesX64\Inkscape\bin\inkscape.exe`.
- [x] `inkscape.exe` funciona; `inkscape.com` existe en ese MSIX pero su ejecución directa devolvió acceso denegado en esta sesión.
- [x] La instalación no está visible en el `PATH` heredado por esta sesión.
- [x] La sonda local de `--action-list` termina headless con Inkscape 1.4.4. La revalidación de F01-G02 observó 189 acciones únicas; la cifra histórica de 1.075 no se reprodujo y no se usa para anunciar capabilities ni cerrar esa puerta.
- [x] La ayuda local declara tipos de salida por CLI `svg,png,ps,eps,pdf,emf,wmf,xaml`; cada uno sigue sujeto a una sonda real antes de anunciarse.
- [x] La ayuda local confirma opciones para área, páginas, DPI, anchura/altura, fondo, modos PNG, PDF 1.4/1.5 y texto a paths.

### 2.2 Consecuencias técnicas

- El servidor no puede depender de `inkscape` en `PATH`.
- La detección de Windows debe revisar configuración, entorno, `PATH`, App Paths, registro de desinstalación, paquetes AppX/MSIX y rutas estándar.
- Cada candidato se debe ejecutar con `--version`; existir en disco no basta.
- En Windows se debe preferir el candidato que realmente permite captura de salida y ejecución headless.
- La sonda debe usar un identificador de aplicación único cuando corresponda (`--app-id-tag`) para no enviar la petición a una instancia GUI existente.
- Las advertencias GTK observadas se deben clasificar y no convertir automáticamente en fallos si el exit code y el artefacto son válidos.
- La ruta exacta de `WindowsApps` cambia con cada actualización; jamás debe quedar hardcodeada.

---

## 3. Visión del producto

Construir un servidor MCP local, determinista y seguro que permita a un cliente de IA:

- descubrir Inkscape y sus capacidades reales;
- crear y comprender documentos SVG/Inkscape;
- controlar tamaño físico, unidades, `viewBox`, orientación, páginas, márgenes y encaje del contenido;
- inspeccionar, crear y modificar elementos de diseño;
- trabajar con capas, grupos, orden Z, estilos, texto, imágenes, paths, definiciones y metadatos;
- renderizar previews;
- importar formatos que la instalación soporte;
- exportar de forma individual o por lotes a PNG, PDF, SVG y formatos adicionales soportados;
- validar dimensiones, páginas, estructura y artefactos producidos;
- proteger originales y restringir todas las operaciones a uno o más workspaces autorizados.

### 3.1 Principio de arquitectura

El servidor será **híbrido y headless-first**:

1. **Motor DOM SVG seguro** para operaciones deterministas de estructura, atributos, estilos, metadatos, capas y creación de formas.
2. **Adaptador CLI/actions de Inkscape** para render, consulta de bounds, conversiones, operaciones booleanas, efectos y exportaciones.
3. **Capa de orquestación** que elige el backend, verifica el resultado y normaliza diferencias entre versiones/plataformas.
4. **Puente GUI/extensión opcional y posterior**, únicamente para capacidades imposibles o poco fiables en headless. No forma parte del MVP ni puede ser requisito para las operaciones esenciales.

### 3.2 Lo que significa “hacer todo lo posible”

No significa prometer que cualquier acción interactiva de la interfaz tendrá una API estable. Significa:

- cubrir explícitamente las áreas de diseño enumeradas en este plan;
- ofrecer operaciones semánticas de alto nivel;
- añadir un escape hatch SVG seguro para fragmentos bien formados;
- descubrir acciones/extensiones disponibles en cada instalación;
- devolver `UNSUPPORTED_CAPABILITY` con explicación y alternativa cuando algo no sea viable;
- documentar diferencias visuales, de fuentes, filtros, extensiones y plataformas;
- ampliar por capacidades sin romper el contrato MCP.

### 3.3 Fuera de alcance inicial

- Automatización por coordenadas de ratón/teclado.
- Control remoto abierto a Internet.
- Ejecución arbitraria de shell, Python, extensiones o acciones aportadas por el cliente.
- Edición colaborativa en tiempo real.
- Reemplazar un motor profesional de preprensa o garantizar CMYK/PDF-X sin una cadena externa validada.
- Garantizar identidad visual entre plataformas cuando faltan fuentes, perfiles o extensiones.
- Implementar un modelo generativo dentro del servidor; el MCP expone herramientas deterministas al modelo cliente.
- Autoría completa de animación SMIL/CSS o video en 1.0; el servidor debe preservar markup seguro que no edita y declararlo en inspección.

---

## 4. Objetivos, prioridades y versiones del producto

### P0 — Núcleo obligatorio / MVP

- Descubrimiento fiable de Inkscape.
- Workspace y ejecución de procesos seguros.
- Crear, inspeccionar y guardar SVG.
- Tamaño de página/documento, unidades, orientación y `viewBox`.
- Encajar página a dibujo/selección con margen.
- Escalar o no escalar contenido mediante políticas explícitas.
- Preview PNG.
- Exportación individual y batch a PNG, PDF y SVG.
- Lectura y exportación de documentos multipágina ya existentes.
- Validación post-exportación.
- Backups, revisiones y `dryRun`.
- Transporte MCP stdio.

### P1 — Versión 1.0 de diseño

- CRUD y reordenamiento de páginas múltiples.
- Consulta y CRUD de elementos.
- Capas, grupos, orden Z, alineación y distribución.
- Transformaciones y estilos.
- Texto e imágenes.
- Operaciones de paths principales.
- Gradientes, patrones, marcadores, clip y mask.
- Importación controlada.
- Preflight web/print/interchange.
- Recursos MCP, manifests, prompts de workflow y progreso/cancelación.

### P2 — Cobertura avanzada

- Filtros y blend modes.
- Símbolos, clones, guías y grids.
- Trazado de bitmap cuando la capacidad exista.
- Live Path Effects seleccionados y testeados.
- Paquetes de assets y presets de canal.
- SVG optimizado mediante adaptador opcional.
- PS, EPS, EMF, WMF, XAML y formatos de extensiones disponibles.
- Transporte Streamable HTTP local seguro.

### P3 — Investigación opcional

- Extensión de Inkscape compañera para operaciones que requieran contexto GUI.
- Integración con sistema de color/preprensa externo.
- Contenedor/sandbox reforzado para documentos no confiables.
- Catálogo de plugins/adaptadores de exportación de terceros.

---

## 5. Criterios globales de éxito

El proyecto solo se considera listo para versión 1.0 si:

- [ ] Un cliente MCP puede conectar por stdio sin bytes ajenos a JSON-RPC en stdout.
- [ ] `doctor` localiza esta instalación MSIX de Inkscape 1.4.4 sin ruta hardcodeada.
- [ ] Se puede crear un A4 de 210 × 297 mm con `viewBox` coherente.
- [ ] Se puede cambiar el tamaño de página sin escalar contenido.
- [ ] Se puede escalar contenido conservando relación de aspecto.
- [ ] Se puede encajar la página al dibujo con margen verificable.
- [ ] Se puede exportar un PNG de dimensiones exactas y transparencia controlada.
- [ ] Se puede exportar un PDF y comprobar versión, número de páginas y cajas.
- [ ] Se puede exportar SVG Inkscape y SVG plano parseables.
- [ ] Un lote de exportación produce todos los artefactos o falla sin publicar un lote parcial, según la política elegida.
- [ ] Toda mutación devuelve nueva revisión SHA-256 y resumen de cambios.
- [ ] Una revisión desactualizada impide sobrescritura accidental.
- [ ] Inputs maliciosos de path, XML y argumentos son rechazados por pruebas.
- [ ] Cancelación/timeout no dejan temporales ni procesos huérfanos.
- [ ] Los errores de capacidad son accionables y no se presentan como éxito parcial silencioso.
- [ ] La suite unitaria, de integración real, MCP y seguridad pasa en Windows.
- [ ] README, contratos, ejemplos de cliente, limitaciones y matriz de compatibilidad están actualizados.

### Métricas de calidad

- 100 % de tools públicas con schema de entrada estricto, `outputSchema`, ejemplos y anotaciones correctas.
- 100 % de mutaciones cubiertas por pruebas de revisión/backup/overwrite.
- 100 % de subprocessos con timeout, cancelación, límites de salida y `shell: false`.
- 0 rutas absolutas externas al workspace expuestas al cliente.
- 0 escrituras directas sobre el archivo destino antes de validar un temporal.
- 0 opciones públicas `rawArgs`, `rawCommand`, `rawActions` o equivalentes.
- Cobertura de ramas acordada en F00; objetivo inicial recomendado: ≥ 85 % en dominio/seguridad y ≥ 75 % global, sin usar la cifra para ocultar casos críticos.

---

## 6. Arquitectura objetivo

```text
Cliente MCP
    |
    +-- stdio (predeterminado)
    +-- Streamable HTTP local (opt-in)
    |
MCP / contratos
    +-- tools
    +-- resources + resource links
    +-- prompts
    +-- progreso / cancelación
    |
Servicios de dominio
    +-- documentos y revisiones
    +-- páginas, tamaños, unidades y geometría
    +-- elementos, estilos, texto, imágenes y paths
    +-- importación, preview, exportación y preflight
    +-- presets, lotes, manifests y jobs
    |
Backends
    +-- DOM SVG seguro
    +-- CLI/actions de Inkscape
    +-- adaptadores opcionales por extensión/formato
    |
Infraestructura y seguridad
    +-- roots/canonicalización
    +-- locks, temporales y commit atómico
    +-- runner, límites, aborto y limpieza
    +-- caché de capacidades
    +-- logs/telemetría
```

### 6.1 Capas y reglas de dependencia

#### MCP

- Traduce schemas a comandos de dominio.
- No construye `argv`, no parsea XML y no toca directamente el filesystem.
- Registra el catálogo de tools en orden determinista.
- Usa una factoría `buildServer()` sin estado de sesión implícito.

#### Dominio

- Expresa operaciones en tipos propios: `Length`, `PageSpec`, `ExportSpec`, `Selector`, `DesignOperation`.
- Decide políticas de resize/export y genera planes ejecutables.
- No conoce transporte MCP.

#### Adaptadores

- `SvgDocumentAdapter`: parseo, consulta, mutación y serialización segura.
- `InkscapeAdapter`: versión, capacidades, acciones, queries, import/export/render.
- Adaptadores opcionales: optimizador SVG, inspección PDF, fuentes/perfiles.

#### Infraestructura

- Garantiza que una ruta está autorizada antes de abrirla.
- Ejecuta procesos sin shell.
- Gestiona concurrencia, cancelación, temporales, hashes y atomicidad.
- No contiene lógica de diseño.

### 6.2 Flujo de una mutación

```text
validar schema
  -> resolver documento dentro del root
  -> verificar expectedRevision
  -> adquirir lock canónico
  -> crear snapshot/temporal
  -> parsear y validar SVG
  -> planificar operación (dryRun puede terminar aquí)
  -> aplicar DOM y/o Inkscape
  -> reabrir y validar resultado
  -> calcular diff resumido + SHA-256
  -> commit atómico / publicar artefacto
  -> liberar lock y limpiar temporales
```

### 6.3 Flujo de una exportación

```text
validar ExportSpec
  -> resolver input/output
  -> inspeccionar documento/capacidades
  -> normalizar área, tamaño, páginas y formato
  -> construir argv desde enums
  -> exportar a temporal
  -> verificar firma, metadatos y límites
  -> calcular SHA-256
  -> commit atómico
  -> devolver artifact resource_link + manifest
```

---

## 7. Stack técnico propuesto

- Runtime: Node.js 24 LTS; fijar rango exacto después del spike de F00.
- Baseline inicial de Inkscape: **1.4.4 exacto**. Otras 1.4.x se anuncian solo tras pruebas; 1.5+ requiere un adaptador de páginas distinto.
- Lenguaje: TypeScript estricto, ESM.
- Gestor: npm con `package-lock.json` versionado.
- MCP: SDK TypeScript v2, paquete `@modelcontextprotocol/server`.
- Schemas: Zod v4 con objetos estrictos.
- Tests: Vitest más ejecutables fake y pruebas end-to-end.
- Build: `tsc` o bundler mínimo solo si aporta empaquetado; decidir mediante ADR.
- Logging: stderr estructurado en stdio; OpenTelemetry/logger estructurado en HTTP.
- Hash: `node:crypto` SHA-256.
- Procesos: `node:child_process.spawn`, `shell: false`, `windowsHide: true`, `AbortSignal`.
- XML/DOM: elegir en F02 mediante spike de fidelidad; debe conservar namespaces y rechazar DTD/XXE.
- Geometría/path: elegir librería tras corpus comparativo; no mezclar geometría aproximada con bounds autoritativos sin señalarlo.
- Validación PNG/PDF/SVG: adaptadores explícitos y dependencias JS puras cuando sea razonable.

No fijar versiones desde memoria. En F00 verificar versiones publicadas, compatibilidad Node 24, licencias, advisories y bloquearlas en lockfile.

### 7.1 Estructura futura

```text
.
|-- AGENTS.md
|-- PLAN_IMPLEMENTACION.md
|-- README.md
|-- LICENSE
|-- SECURITY.md
|-- CHANGELOG.md
|-- package.json
|-- package-lock.json
|-- tsconfig.json
|-- eslint.config.js
|-- vitest.config.ts
|-- .editorconfig
|-- .gitattributes
|-- .gitignore
|-- src/
|   |-- cli.ts
|   |-- server/
|   |   |-- build-server.ts
|   |   |-- instructions.ts
|   |   |-- tools/
|   |   |-- resources/
|   |   `-- prompts/
|   |-- domain/
|   |   |-- documents/
|   |   |-- geometry/
|   |   |-- design/
|   |   |-- export/
|   |   |-- import/
|   |   |-- preflight/
|   |   `-- jobs/
|   |-- adapters/
|   |   |-- inkscape/
|   |   |-- svg/
|   |   |-- png/
|   |   |-- pdf/
|   |   `-- optional/
|   |-- infrastructure/
|   |   |-- workspace/
|   |   |-- process/
|   |   |-- files/
|   |   |-- locks/
|   |   |-- telemetry/
|   |   `-- config/
|   |-- schemas/
|   |-- presets/
|   `-- shared/
|-- tests/
|   |-- unit/
|   |-- contract/
|   |-- integration/
|   |-- e2e/
|   |-- security/
|   |-- visual/
|   |-- fakes/
|   `-- fixtures/
|-- docs/
|   |-- architecture/
|   |-- tools/
|   |-- compatibility/
|   |-- examples/
|   `-- progress/
|-- schemas/
|-- presets/
`-- scripts/
```

---

## 8. Modelo de configuración

Precedencia: flags CLI > variables de entorno documentadas > archivo de configuración > defaults seguros.

Configuración prevista:

```yaml
transport: stdio
workspaceRoots:
  - C:/ruta/autorizada
scratchRoot: auto # server-owned; no es direccionable por tools
inkscapeBin: auto
maxConcurrency: 2
processTimeoutMs: 60000
maxInputBytes: 52428800
maxArtifactBytes: 209715200
maxStdoutBytes: 8388608
maxStderrBytes: 8388608
maxInlineBytes: 1048576
maxResourceReadBytes: 4194304
maxDecodedRasterBytes: 536870912
maxRasterMegapixels: 100
maxOperationsPerCall: 100
overwriteDefault: false
backupPolicy: on-in-place-mutation
externalResources: deny
nativeInputPolicy: trusted-local-only # 1.0 no es un sandbox de parsers nativos
maximumSanitizeMode: preserve-local # solo config de arranque puede elevarlo a trusted
http:
  host: 127.0.0.1
  port: 3000
  auth: required
```

Reglas:

- Debe existir al menos un root explícito.
- No depender del feature MCP Roots, deprecado en la revisión 2026-07-28; los roots son configuración propia del servidor.
- `workspaceRoots` autorizan documentos/assets/outputs aportados por el cliente; `scratchRoot` es interno y server-owned.
- Ejecutable, data dirs, extensiones y fuentes son dependencias read-only descubiertas/configuradas al arrancar; nunca se convierten en roots navegables por tools.
- No usar el home, raíz de disco o workspace padre implícitamente.
- `INKSCAPE_BIN`/`--inkscape-bin` se resuelve al iniciar, nunca desde una tool.
- Los límites deben tener topes compilados; la configuración no puede convertirlos en infinitos.
- El archivo de config nunca debe contener tokens HTTP en ejemplos versionados.
- `--doctor` debe ser no destructivo.

---

## 9. Seguridad y modelo de amenazas

### 9.1 Paths y filesystem

Threat model 1.0: el cliente y la estructura/rutas de los documentos se tratan como no confiables. La versión 1.0 protege contra traversal, inyección de argumentos/actions, XML activo, agotamiento dentro de límites probados y publicación inconsistente; **no afirma contener vulnerabilidades desconocidas de los parsers nativos de Inkscape, Poppler o codecs**. Sin un sandbox reforzado, los archivos que lleguen a esos parsers deben ser de origen local confiable (`nativeInputPolicy: trusted-local-only`). `inkscape_status`/`doctor` deben declarar `securityLevel`, `nativeInputPolicy` y esta limitación. Tampoco se promete resistencia absoluta frente a otro proceso local con permisos de escritura que cambie junctions/reparse points durante la operación. Los roots deben pertenecer al usuario del servidor y no ser escribibles por actores locales hostiles. Para el escenario más fuerte se requiere sandbox/ACL/handle-based helper nativo y queda en F12.

```ts
type SecurityPosture = {
  securityLevel: "workspace-guarded-native-unsandboxed" | "native-sandboxed";
  nativeParserIsolation: "none" | "os-sandbox";
  nativeInputPolicy: "trusted-local-only" | "sandbox-allows-untrusted";
  maximumSanitizeMode: "strict" | "preserve-local" | "trusted";
  residualRisks: string[];
};
```

Un Job Object controla ciclo de vida/cleanup, pero **no** cuenta como sandbox. En el baseline, `doctor` debe emitir una advertencia visible para `workspace-guarded-native-unsandboxed` y no usar vocabulario como “seguro para archivos hostiles”.

- Aceptar en tools solo rutas relativas o IDs opacos.
- Rechazar rutas absolutas, UNC, drive-relative, NUL, ADS de NTFS y segmentos `..`.
- Canonicalizar roots con `realpath` al inicio.
- Para inputs existentes, canonicalizar el archivo y verificar pertenencia mediante `path.relative`.
- Para outputs nuevos, canonicalizar el padre existente y repetir la comprobación justo antes del rename.
- Considerar comparación case-insensitive en Windows cuando corresponda.
- Rechazar symlink/reparse point final para outputs; probar carrera TOCTOU.
- Tratar `realpath + recheck` como mitigación, no como garantía atómica contra atacante local concurrente; documentar el riesgo residual.
- Aplicar allowlist de extensiones y sniffing de contenido; no confiar solo en el sufijo.
- Crear temporales dentro del directorio autorizado o de un scratch root explícito.
- Usar rename/replace atómico compatible con Windows y documentar fallback.
- `overwrite=false` por defecto.
- Crear backup antes de cualquier edición in-place.
- Bloquear por ruta canónica y usar `expectedRevision` SHA-256.
- No devolver paths absolutos; devolver URIs opacas `inkscape://...`.

### 9.2 SVG/XML no confiable

- Rechazar `DOCTYPE` y entidades externas.
- Limitar profundidad, nodos, atributos, tamaño de strings y expansión.
- Detectar/restringir `<script>`, atributos `on*`, `javascript:`, `foreignObject` y referencias externas.
- No descargar automáticamente imágenes, CSS, fuentes o perfiles remotos.
- Ofrecer política `sanitizeMode: strict|preserve-local|trusted`, con `strict` por defecto para importados. El máximo nivel de confianza es configuración administrativa de arranque: una tool puede pedir el mismo modo o uno más restrictivo, pero jamás elevarlo. `trusted` no puede seleccionarse desde una tool ni por contenido del documento; todo intento de downgrade se rechaza y audita.
- Resolver referencias `href` únicamente dentro de roots autorizados si la política lo permite.
- No enviar el SVG completo como texto al cliente salvo recurso explícito y límite de tamaño.

### 9.3 Procesos

- Usar `spawn(executable, argv, { shell: false })`.
- Construir `argv` únicamente desde enums y valores validados.
- No concatenar una cadena de shell.
- No exponer `extraArgs`, `rawActions`, `extensionId` arbitrario ni ruta de ejecutable en tools.
- Para `--actions`, no confiar en un escape general: la gramática usa `;`, `:`, comas y otros separadores sin mecanismo universal seguro.
- Solo generar actions desde registry allowlisted cuyos argumentos sean enums/números o IDs temporales remapeados a un alfabeto seguro. Texto, CSS, paths y valores libres se modifican por DOM, no se interpolan en action strings.
- Rechazar separadores/control chars en cualquier argumento de acción y probar cada wrapper. `--actions-file` usa la misma gramática: evita límites de línea, pero no resuelve inyección.
- Aplicar el mismo remapeo a IDs usados por CLI: `--query-id`, `--select`, `--export-id` y `--query-all`. Para `--query-all`, consultar una copia staging cuyos IDs ya fueron remapeados en vez de intentar desambiguar CSV inseguro después. No pasar IDs originales que contengan coma, punto y coma, dos puntos, whitespace o controles; mantener y devolver el mapping reversible.
- Usar cwd temporal seguro y entorno mínimo compatible.
- Crear antes de cada invocación nativa un bundle inmutable en staging: copiar/hash del SVG y dependencias locales autorizadas, reescribir sus URI a esa copia y ejecutar Inkscape sobre el bundle, no sobre archivos que otro writer pueda cambiar. Revalidar source/dependencias y destino antes del commit.
- Consumir stdout y stderr con límites independientes para evitar memoria ilimitada.
- Aplicar timeout y cancelación; en Windows asociar el proceso a un Job Object o mecanismo equivalente desde el lanzamiento y cerrar el árbol completo, incluidos nietos que ignoren la primera terminación.
- Esperar cierre real antes de declarar éxito.
- Validar el artefacto aunque exit code sea 0.
- Tratar stderr como diagnóstico; clasificar warnings conocidos sin ocultarlos.

### 9.4 HTTP opcional

- Escuchar solo en `127.0.0.1` por defecto.
- Validar `Host` y `Origin` contra DNS rebinding.
- Requerir token bearer siempre que HTTP esté activo, incluso en loopback; nunca existe modo HTTP anónimo.
- No confiar en sesiones MCP implícitas; cada request debe resolver autorización y estado explícito.
- Añadir rate limits, body limits, timeout y telemetría.
- TLS/remoto/OAuth son un proyecto de despliegue separado y requieren threat model nuevo.

### 9.5 Privacidad y logs

- En stdio, stdout queda reservado para MCP; todo log va a stderr.
- Redactar rutas, nombres sensibles, tokens y contenido SVG.
- Registrar operación normalizada, duración, exit code, hashes y códigos de warning.
- No registrar blobs, XML completo ni imágenes.
- Hacer correlación por `operationId`/`jobId` opaco.

---

## 10. Semántica de documento, unidades y tamaños

### 10.1 Tipos base

```ts
type PhysicalUnit = "mm" | "cm" | "in" | "pt" | "pc" | "q";
type PhysicalLength = { value: number; unit: PhysicalUnit };
type CssPixelLength = { value: number; unit: "px" };
type ViewportLength = PhysicalLength | CssPixelLength;
type PageSize = { width: ViewportLength; height: ViewportLength };

type UserCoordinateSpace =
  { kind: "document_user" } | { kind: "page_local"; pageId: string };
type ViewportCoordinateSpace =
  { kind: "document_css_px" } | { kind: "page_css_px"; pageId: string };
type UserPoint = { x: number; y: number; space: UserCoordinateSpace };
type UserRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  space: UserCoordinateSpace;
};
type ViewportPoint = { x: number; y: number; space: ViewportCoordinateSpace };
type AffineTransform = {
  from: UserCoordinateSpace | ViewportCoordinateSpace;
  to: UserCoordinateSpace | ViewportCoordinateSpace;
  matrix: readonly [number, number, number, number, number, number];
};

type ReadDocumentRef = { documentId: string; expectedRevision?: string };
type MutationDocumentRef = { documentId: string; expectedRevision: string };
type OutputTarget =
  | { outputPath: string; overwrite?: false }
  | { outputPath: string; overwrite: true; expectedOutputRevision: string };
type MultiOutputTarget = {
  outputDirectory: string;
  fileNameTemplate: string;
  publish: "directory_rename" | "manifest_commit";
  overwrite?: false | { expectedManifestRevision: string };
};
```

Reglas:

- Usar 96 CSS px por pulgada para conversiones SVG, salvo contexto explícito que exija otra cosa.
- No confundir unidades físicas del viewport con unidades de usuario del `viewBox`.
- No asignar una unidad física a una coordenada de usuario. Toda coordenada lleva su espacio y toda conversión devuelve una `AffineTransform` explícita.
- `viewBox` y `preserveAspectRatio` pueden producir escalas X/Y diferentes; conversiones y DPI efectivo se calculan por eje, no con un escalar implícito.
- Rechazar NaN, infinito, cero o negativos donde no tengan significado.
- Definir y probar política de redondeo; conservar máxima precisión internamente.
- Reportar tanto tamaño físico como tamaño en px a 96 dpi.
- Toda mutación de documento existente usa `MutationDocumentRef`; la revisión nunca es opcional.
- Una lectura/export puede fijar `expectedRevision` para garantizar consistencia y recibe conflicto si el source cambia.
- Un output nuevo falla si ya existe; sobrescribirlo exige lock y `expectedOutputRevision` SHA-256.

### 10.2 Modos de redimensionado

Política de `viewBox` obligatoria:

```ts
type ViewBoxPolicy =
  | "preserve_user_scale" // default de page_only
  | "preserve_viewbox" // cambia la escala física del contenido
  | "explicit"; // exige viewBox completo

type ViewBoxPolicyInput =
  | { policy: "preserve_user_scale" }
  | { policy: "preserve_viewbox" }
  | { policy: "explicit"; viewBox: UserRect };
```

- `page_only + preserve_user_scale` cambia viewport y dimensiones del `viewBox` proporcionalmente para conservar unidades físicas y no cambia geometría/transforms del contenido. El anchor decide el nuevo origen.
- `page_only + preserve_viewbox` conserva el `viewBox`; por tanto cambia la escala física aparente del contenido. Debe devolver warning `DOCUMENT_SCALE_CHANGED` y nunca es el default.
- `explicit` exige `x`, `y`, `width`, `height` y declara que el caller controla la escala.
- Si las escalas X/Y iniciales difieren, `preserve_user_scale` conserva cada eje por separado y reporta `NON_UNIFORM_DOCUMENT_SCALE`.
- Rectángulos custom se expresan en `document_user` o `page_local`; el servidor convierte a root user units antes de invocar Inkscape.

Reglas para escalar contenido:

- Operar solo sobre hijos gráficos del root/página; excluir `defs`, `metadata`, `namedview`, `style`, scripts y recursos no renderizados.
- Antes de envolver o añadir transforms, analizar selectores CSS porque un wrapper puede cambiar child/descendant selectors y herencia. El motor CSS soportado y su subconjunto quedan fijados por ADR.
- Cada resultado declara fidelidad `exact|partial|approximate` y pérdidas concretas. `partial`/`approximate` requieren `allowApproximate=true`; de otro modo la operación falla sin mutar.
- Probar specificity, `!important`, `currentColor`, custom properties, porcentajes, `objectBoundingBox`, `vector-effect="non-scaling-stroke"`, markers, clips, masks y filtros. Si no se puede conservar semántica, ofrecer aplanado de estilos calculados como modo explícito con warning.

| Modo                    | Cambia página |                   Cambia `viewBox` |                 Cambia contenido | Uso                                 |
| ----------------------- | ------------: | ---------------------------------: | -------------------------------: | ----------------------------------- |
| `page_only`             |            Sí | Sí por default; política explícita |                               No | Cambiar lienzo sin tocar geometría  |
| `scale_content_contain` |            Sí |                                 Sí |                  Escala uniforme | Encajar todo sin recortar           |
| `scale_content_cover`   |            Sí |                                 Sí | Escala uniforme y puede recortar | Llenar formato destino              |
| `scale_content_stretch` |            Sí |                                 Sí |               Escala no uniforme | Solo opt-in con warning             |
| `fit_page_to_drawing`   |            Sí |                                 Sí |                               No | Ajustar página al bounds del dibujo |
| `fit_page_to_selection` |            Sí |                                 Sí |                               No | Ajustar a objetos seleccionados     |
| `crop`                  |            Sí |                                 Sí |                               No | Recortar viewport a rectángulo      |
| `expand`                |            Sí |                                 Sí |                               No | Añadir márgenes/bleed               |

Cada operación debe declarar:

- página objetivo o `all`;
- tamaño/orientación objetivo;
- anchor de contenido: centro, esquinas o punto custom;
- preservación de aspect ratio;
- margen por lado;
- inclusión de stroke/filter bounds;
- política para objetos fuera de página;
- `dryRun` y preview opcional.

Vectores normativos iniciales:

- A4 `210mm × 297mm`, `viewBox="0 0 210 297"` → `148mm × 210mm`, `page_only/preserve_user_scale/top_left`: `viewBox="0 0 148 210"`; elementos sin cambios.
- El mismo A4 → `420mm × 594mm`, `page_only/preserve_viewbox`: `viewBox="0 0 210 297"`; el tamaño físico renderizado del contenido se duplica y se emite warning.
- Contenido `800 × 600` → página `1080 × 1080`, contain/center: escala `1.35`, bounds `1080 × 810`, offset vertical `135`.
- El mismo contenido con cover/center: escala `1.8`, bounds `1440 × 1080`, crop horizontal `180` por lado.
- Bounds visuales `x=-10,y=20,w=100,h=50` a 1 user unit/mm + margen 3 mm: nuevo rect `x=-13,y=17,w=106,h=56`.

### 10.3 Multipágina

- Modelar páginas con ID opaco, número, label, x/y, width/height y unidad normalizada.
- No asumir que el número es un identificador estable después de reorder/delete.
- La página root usa un ID opaco derivado de `documentId + root`; una página adicional conserva su XML ID si es válido.
- Si una página adicional carece de ID, una lectura devuelve un ID sintético marcado con revisión/índice; la primera mutación le asigna un ID persistente y devuelve el mapping. Nunca se promete estabilidad de un ID sintético entre revisiones.
- Soportar list/add/update/delete/reorder con verificación de referencias.
- Detectar solapamientos de páginas y objetos compartidos.
- Distinguir “exportar el documento PDF multipágina” de “exportar cada página a archivos separados”.
- En el código exacto 1.4.4, `--export-page` itera/poda cada página y escribe archivos `_pN`, incluso para PDF; el man es ambiguo. La sonda lo confirma por build y detecta drift futuro. El PDF completo sin subset se exporta sin ese flag y se valida por page count.

### 10.4 Presets iniciales

- ISO A0–A10, B y C relevantes.
- US Letter, Legal, Tabloid/Ledger.
- Business card configurable por región.
- Pantallas 16:9, 4:3 y custom.
- Iconos 16, 24, 32, 48, 64, 128, 256, 512, 1024 px.
- Social presets en archivo versionado, con fecha/fuente y sin asumir que dimensiones de plataformas son eternas.
- Preset custom sin necesidad de editar código.

### 10.5 Márgenes, bleed y marcas

```ts
type BleedSpec = {
  top: PhysicalLength;
  right: PhysicalLength;
  bottom: PhysicalLength;
  left: PhysicalLength;
  behavior: "metadata-only" | "expand-temporary-page";
};
```

- `margin` es espacio añadido al área de exportación/encaje; `bleed` es extensión física para impresión; nunca son sinónimos.
- El bleed no cambia el documento original salvo mutación explícita. Para exportar, se materializa solo en una copia temporal y se verifica contra las boxes/medidas del artefacto.
- Crop marks son una capability separada. No se generan por el mero hecho de definir bleed y no se anuncian sin adaptador/fixture probado.
- El preflight informa bleed requerido, presente y faltante por lado, con unidades físicas normalizadas.

---

## 11. Semántica de exportación

### 11.1 Contrato normalizado

```ts
type CommonExport = {
  source: ReadDocumentRef;
  target: OutputTarget | MultiOutputTarget;
};
type EdgeInsets = {
  top: ViewportLength;
  right: ViewportLength;
  bottom: ViewportLength;
  left: ViewportLength;
};
type SelectionArea = {
  kind: "selection";
  elementIds: string[];
  output: "combined" | "each";
  visibility: "document" | "selected-only";
};
type PngArea =
  | { kind: "page"; pageIds?: string[] }
  | { kind: "drawing" }
  | SelectionArea
  | { kind: "custom"; rect: UserRect };
type VectorArea =
  | { kind: "document" }
  | { kind: "pages"; pageIds: string[] }
  | { kind: "drawing" }
  | SelectionArea;
type PngSize =
  | { mode: "dpi"; dpi: number }
  | { mode: "width"; widthPx: number; dpiHint?: number }
  | { mode: "height"; heightPx: number; dpiHint?: number }
  | {
      mode: "exact";
      widthPx: number;
      heightPx: number;
      dpiHint?: number;
      allowDistortion?: boolean;
    };
type PngBackground =
  | { mode: "document" }
  | { mode: "transparent" }
  | { mode: "solid"; color: string; opacity: number };

type PngExportSpec = CommonExport & {
  format: "png";
  area: PngArea;
  size?: PngSize;
  margin?: EdgeInsets;
  background: PngBackground;
  bitDepth?: 8 | 16;
  compression?: number;
  antialias?: number;
  snapAreaToPixels?: boolean;
};
type PdfExportSpec = CommonExport & {
  format: "pdf";
  area: VectorArea;
  version?: "1.4" | "1.5";
  text: "preserve" | "paths";
  filterRasterDpi?: number;
  filters: "preserve" | "ignore-with-warning";
  margin?: EdgeInsets;
  latex?: boolean;
};
type SvgExportSpec = CommonExport & {
  format: "svg" | "plain-svg" | "svgz";
  area: VectorArea;
  text: "preserve" | "paths";
  resourcePolicy: "preserve-local" | "embed" | "reject-external";
};
type PsExportSpec = CommonExport & {
  format: "ps";
  area: Exclude<VectorArea, { kind: "document" }>;
  level: 2 | 3;
  text: "preserve" | "paths";
  filterRasterDpi?: number;
};
type EpsExportSpec = CommonExport & {
  format: "eps";
  area: { kind: "drawing" } | SelectionArea;
  level: 2 | 3;
  text: "preserve" | "paths";
  filterRasterDpi?: number;
};
type MetafileExportSpec = CommonExport & {
  format: "emf" | "wmf" | "xaml";
  area: { kind: "drawing" } | SelectionArea;
};
type ExportSpec =
  | PngExportSpec
  | PdfExportSpec
  | SvgExportSpec
  | PsExportSpec
  | EpsExportSpec
  | MetafileExportSpec;
```

La validación debe rechazar combinaciones fuera de la rama discriminada. `output: each` o múltiples páginas PNG exige `MultiOutputTarget`; un resultado único exige `OutputTarget`. La plantilla solo admite tokens allowlisted y nombres relativos seguros. El área custom es nativa solo para PNG en el contrato estable. Un formato vectorial puede simularla únicamente mediante documento temporal y estrategia registrada en el manifest. EPS nunca acepta área de página.

### 11.2 Precedencia de tamaño raster

- `mode: exact`: dimensiones exactas; si deforman la relación, exigir `allowDistortion=true`.
- `mode: width`: calcular altura conservando ratio.
- `mode: height`: calcular ancho conservando ratio.
- `mode: dpi`: derivar píxeles desde tamaño físico/área.
- Ninguno: usar 96 dpi.
- `dpiHint` junto con width/height: width/height mandan para píxeles; devolver DPI efectivo y warning si difiere.
- Si se especifican width y height incompatibles, Inkscape puede usar escalas/DPI distintos por eje; rechazar por defecto y exigir `allowDistortion=true`.
- Definir redondeo half-up o equivalente y probar A4 a 300 dpi (esperado por política: 2480 × 3508 px).

### 11.3 PNG

Cubrir:

- área page/drawing/selection/custom;
- width/height/DPI;
- fondo `document|transparent|solid`; `document` lee `pagecolor/pageopacity` y no equivale implícitamente a transparente;
- opacidad del fondo y settings documentales `pagecolor`, `pageopacity`, color de desk y border;
- color modes declarados por la versión;
- 8/16 bit cuando se soporte;
- dithering, compresión 0–9 y antialias 0–3 si la capacidad está presente;
- snap de área a píxeles;
- límites de Inkscape detectados/probados (en 1.4.4: DPI 0.1–10000) más un tope de megapíxeles propio mucho más conservador;
- exportación por página/objeto;
- manifest con dimensiones reales, modo, bytes y hash.

Validar leyendo firma e IHDR; no confiar en nombre de archivo.

`--export-margin` no aplica directamente a PNG. Un margen raster debe resolverse ampliando el área/temporal de forma explícita y probada, nunca pasando un flag inefectivo.

### 11.4 PDF

Cubrir:

- PDF 1.4 y 1.5 cuando la instalación lo declare;
- documento multipágina y páginas separadas como modos distintos;
- subset de páginas a un único PDF: en 1.4.4 usar poda de una copia SVG temporal y exportarla completa; reservar camino directo para una capability futura probada, y unión externa solo como último fallback explícito;
- margen de exportación;
- texto preservado o convertido a paths;
- DPI de filtros rasterizados;
- ignorar filtros solo mediante opción explícita con warning visual;
- exportación LaTeX como conjunto de artefactos cuando aplique;
- verificación de firma, versión, page count y MediaBox/CropBox.

No prometer CMYK, PDF/X, bleed/crop marks ni incrustación perfecta de fuentes sin preflight/adaptador externo demostrado. Informar fuentes faltantes y color management como warnings de alta severidad.

En el baseline 1.4.4, `--export-margin` tiene reportes/implementación conocida como no fiable. No anunciar margen PDF/PS por flag hasta que una sonda mida las boxes. Si falla, generar una copia SVG temporal con páginas/área expandidas y validar las boxes resultantes.

### 11.5 SVG

Modos:

- `svg`: conserva namespaces/metadatos de Inkscape.
- `plain-svg`: solicita SVG plano y verifica ausencia razonable de atributos específicos, sin afirmar equivalencia visual absoluta.
- `svgz`: comprimido, sujeto a capacidad real.
- `optimized-svg`: adaptador opcional, no confundir con plain SVG.
- selección como fragmento/documento autónomo con ajuste de `viewBox`.
- texto a paths opcional con warning de accesibilidad/editabilidad.

Validar XML, root SVG, namespaces, IDs únicos, referencias internas y políticas de recursos externos.

### 11.6 Formatos adicionales

PS, EPS, EMF, WMF y XAML se implementan detrás de capability gates. Para cada formato:

- mapear flags permitidos;
- producir fixture real;
- validar firma/estructura o reimportación controlada;
- documentar diferencias por plataforma;
- marcar `native`, `extension`, `experimental` o `unavailable`.

Nunca inferir soporte únicamente por extensión: combinar ayuda, lista de extensiones, prueba controlada y versión.

### 11.7 Batch y atomicidad

Modos:

- `best_effort`: devuelve éxitos y fallos por variante; no borra éxitos.
- `all_or_nothing`: valida todo en staging y publica un commit lógico solo si todos validan.

Definición exacta:

- Opción preferida: el resultado es un directorio nuevo y todo el directorio staging se publica con un único rename en el mismo filesystem. Esta es la única modalidad multilarchivo que se puede aproximar a commit filesystem-atómico.
- Si el caller exige varios archivos dentro de un directorio existente, cada rename puede quedar interrumpido por crash. El servidor escribe el manifest/commit marker **al final**; el lote solo se considera publicado si ese marker existe y valida todos los hashes. Ante fallo manejado hace rollback best-effort.
- Nunca describir una secuencia de múltiples renames como transacción crash-atómica.
- Restos de staging tras crash se detectan/limpian al próximo arranque según retención; no aparecen como artifacts MCP publicados.

Requisitos:

- nombres deterministas y protección contra colisiones;
- máximo de variantes configurable;
- progreso por variante;
- cancelación limpia;
- manifest JSON con request normalizado, versión de Inkscape, warnings, artefactos, hashes y duración;
- strategy `directory_rename|manifest_commit`, estado de commit y riesgo residual de crash;
- no incluir rutas absolutas en manifest visible al cliente.

---

## 12. Catálogo MCP objetivo

Mantener cerca de 30 tools semánticas (33 en este catálogo inicial). El catálogo debe ser estable; una capacidad ausente devuelve error recuperable, no elimina dinámicamente la tool.

| Tool                        | Tipo               |    Fase | Propósito                                                              |
| --------------------------- | ------------------ | ------: | ---------------------------------------------------------------------- |
| `inkscape_status`           | lectura            |     F01 | Estado, versión, ruta redactada, capabilities y diagnósticos           |
| `workspace_list_documents`  | lectura            |     F02 | Listar documentos permitidos con paginación                            |
| `document_create`           | mutación           |     F03 | Crear SVG/preset/páginas iniciales                                     |
| `document_inspect`          | lectura            | F03/F04 | Tamaños, páginas, elementos, recursos, fuentes, colores y warnings     |
| `document_settings`         | mutación/lectura   |     F03 | Pagecolor/pageopacity, desk, border y ajustes documentales tipados     |
| `document_preflight`        | lectura            |     F04 | Validar perfil web/print/interchange                                   |
| `document_optimize`         | mutación/derivado  |     F08 | Limpiar/normalizar mediante plan seguro y verificable                  |
| `document_resize`           | mutación           |     F03 | Tamaño, orientación, viewBox, fit/crop/scale                           |
| `document_pages`            | mutación/lectura   |     F03 | List/add/update/delete/reorder de páginas                              |
| `document_snapshot`         | mutación segura    |     F02 | Crear snapshot explícito                                               |
| `document_restore`          | destructiva        |     F02 | Restaurar snapshot con revisión esperada                               |
| `document_render_preview`   | artefacto          |     F04 | Preview PNG limitado                                                   |
| `elements_query`            | lectura            |     F06 | Buscar por ID, tipo, layer o selector seguro                           |
| `elements_create`           | mutación           |     F06 | Crear formas, texto, imagen, grupo/layer y fragmento seguro            |
| `elements_update`           | mutación           |     F06 | Atributos/estilo/texto/geometry allowlisted                            |
| `elements_delete`           | destructiva        |     F06 | Eliminar IDs explícitos                                                |
| `elements_duplicate`        | mutación           |     F06 | Duplicar/clone con IDs nuevos                                          |
| `elements_group`            | mutación           |     F06 | Group/ungroup/reparent/order                                           |
| `elements_transform`        | mutación           |     F06 | Move/scale/rotate/skew/flip/matrix                                     |
| `elements_arrange`          | mutación           |     F06 | Align/distribute/z-order                                               |
| `styles_apply`              | mutación           | F06/F07 | Fill/stroke/opacity/typography/filter refs                             |
| `defs_manage`               | mutación           |     F07 | Gradients/patterns/markers/clip/mask/filter defs                       |
| `paths_operate`             | mutación           |     F07 | Boolean/combine/break/simplify/inset/outset/conversion                 |
| `text_manage`               | mutación           |     F07 | Contenido, tspans, text-on-path, flow y text-to-path                   |
| `images_manage`             | mutación           |     F07 | Place/embed/link/crop/relink/trace gateado                             |
| `document_apply_operations` | mutación atómica   |     F06 | Unión discriminada de operaciones en una transacción                   |
| `document_import`           | mutación/artefacto |     F08 | Convertir/importar con opciones seguras                                |
| `document_export`           | artefacto          |     F05 | Exportación individual validada                                        |
| `document_export_batch`     | artefacto          | F05/F08 | Variantes/presets/manifests                                            |
| `assets_package`            | artefacto          |     F08 | Empaquetar documento, dependencias y manifest                          |
| `job_get`                   | lectura            |     F09 | Estado/progreso/resultado de job largo                                 |
| `job_cancel`                | mutación           |     F09 | Cancelar job autorizado                                                |
| `artifact_read_chunk`       | lectura            |     F09 | Leer un rango acotado de un artefacto autorizado sin cargarlo completo |

### 12.1 Escape hatches permitidos

- `elements_create` puede aceptar un `svgFragment` solo en modo avanzado, sanitizado, con límites, renombrado determinista de IDs y referencias reescritas.
- `elements_update` puede aceptar un patch de atributos allowlisted, nunca XML/XPath arbitrario.
- `paths_operate` puede usar acciones internas allowlisted.
- Un registro interno de acciones puede crecer por versión, pero no habrá `run_inkscape` público.

### 12.2 Resources

- `inkscape://server/capabilities`
- `inkscape://server/presets/page-sizes`
- `inkscape://server/presets/exports`
- `inkscape://document/{id}/metadata`
- `inkscape://document/{id}/summary`
- `inkscape://document/{id}/svg` — opt-in y limitado.
- `inkscape://artifact/{id}`
- `inkscape://artifact/{id}/chunk/{index}` — template con chunks inmutables de hasta `maxResourceReadBytes`.
- `inkscape://export/{jobId}/manifest`

Artefactos grandes se devuelven como `resource_link`; solo previews pequeños se inlinean como `image`. Un read del URI completo que exceda `maxResourceReadBytes` devuelve metadata y enlaces a chunks, no transmite 200 MiB por stdio. `artifact_read_chunk`/el resource template validan owner, revisión/hash, offset, longitud y máximo; HTTP puede hacer streaming autenticado, pero no cambia los límites de autorización.

### 12.3 Prompts

- `audit_document`
- `prepare_web_export`
- `prepare_print_pdf`
- `create_asset_pack`
- `optimize_svg`

Los prompts son recetas visibles/seleccionadas por el usuario. No deben ejecutar mutaciones ocultas.

---

## 13. Contratos y envelope de resultados

### 13.1 Reglas de schemas

- Zod v4 con `z.strictObject` o equivalente estricto.
- Rechazar propiedades desconocidas.
- Enums para formato, unidad, área, versión PDF, color mode y operaciones.
- Límites en strings, arrays, dimensiones, DPI, páginas y operaciones.
- Descripciones que indiquen unidad, sistema de coordenadas y efectos.
- `outputSchema` para toda tool no trivial.
- Devolver texto breve para compatibilidad y el objeto completo en `structuredContent`.
- Mantener resultados como objetos, no escalares/arrays en el nivel superior.

### 13.2 Envelope normalizado

```ts
type CommonResult = {
  operationId: string;
  document?: {
    id: string;
    uri: string;
    previousRevision?: string;
    revision: string;
  };
  artifacts: Array<{
    id: string;
    uri: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    widthPx?: number;
    heightPx?: number;
    pageCount?: number;
  }>;
  warnings: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    elementIds?: string[];
    remediation?: string;
  }>;
  inkscapeVersion?: string;
  durationMs: number;
};

type ToolError = {
  code: string;
  message: string;
  remediation?: string;
  retryable: boolean;
  details?: Record<string, unknown>; // siempre redactado y limitado
};

type ToolResult<T> =
  | (CommonResult & { status: "ok"; data: T })
  | (CommonResult & {
      status: "partial";
      data: T;
      failures: Array<{ itemId: string; error: ToolError }>;
    })
  | (CommonResult & { status: "error"; error: ToolError });
```

Invariantes:

- `ok` requiere `data` y no contiene `error`/`failures`.
- `partial` solo se usa en operaciones cuyo contrato declara `best_effort`; retorna `isError: false`, pero `failures` no puede estar vacío.
- Un batch `all_or_nothing` con cualquier fallo retorna `status: error`, `isError: true` y no publica artefactos finales.
- `error` retorna `isError: true`, contiene `ToolError` y no presenta datos parciales como éxito.
- Un request/protocolo mal formado usa error MCP/`ProtocolError`, no este envelope de dominio.

### 13.3 Códigos de error mínimos

- `INVALID_ARGUMENT`
- `PATH_NOT_ALLOWED`
- `DOCUMENT_NOT_FOUND`
- `REVISION_CONFLICT`
- `OUTPUT_REVISION_CONFLICT`
- `DOCUMENT_LOCKED`
- `INVALID_SVG`
- `UNSAFE_SVG`
- `INKSCAPE_NOT_FOUND`
- `INKSCAPE_UNSUPPORTED_VERSION`
- `UNSUPPORTED_CAPABILITY`
- `IMPORT_FAILED`
- `EXPORT_FAILED`
- `OUTPUT_VALIDATION_FAILED`
- `OVERWRITE_DENIED`
- `TIMEOUT`
- `CANCELLED`
- `RESOURCE_LIMIT_EXCEEDED`
- `FONT_RESOLUTION_UNAVAILABLE`
- `PLAN_TOKEN_INVALID`
- `PLAN_TOKEN_EXPIRED`
- `PARTIAL_BATCH_FAILURE`

Errores recuperables del dominio regresan `status: error`, `isError: true` y remedio. La excepción deliberada es `best_effort`, que usa `partial`/`isError: false` para representar fielmente éxitos y fallos por ítem. Errores de protocolo usan el mecanismo MCP correspondiente.

### 13.4 Anotaciones

- Lecturas: `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`.
- Mutación in-place: `destructiveHint: true` aunque cree backup.
- Exportar a nombre nuevo no es read-only: crea un artefacto.
- Las anotaciones ayudan al host; no reemplazan controles del servidor.

---

## 14. Matriz funcional de diseño

Esta matriz evita que “diseño” quede reducido a exportar archivos. La columna backend indica la ruta preferida, no una promesa de que toda variante sea idéntica en todas las versiones.

| Área              | Capacidades previstas                                                        | Backend principal | Prioridad | Límites/validación             |
| ----------------- | ---------------------------------------------------------------------------- | ----------------- | --------: | ------------------------------ |
| Documento         | crear, abrir, clonar, guardar como, metadata, namespaces                     | DOM               |        P0 | XML seguro y revisión          |
| Página/lienzo     | tamaño, unidades, orientación, viewBox, márgenes, fit/crop/expand            | híbrido           |        P0 | distinguir viewport/contenido  |
| Multipágina       | P0 leer/exportar existente; P1 añadir/redimensionar/mover/eliminar/reordenar | DOM + CLI         |     P0/P1 | comportamiento por versión     |
| Consulta          | IDs, tipos, layers, bounds, estilos, inventario                              | híbrido           |     P0/P1 | bounds visuales vs geométricos |
| Formas            | rect, rounded rect, circle, ellipse, line, polyline, polygon, star, spiral   | DOM               |        P1 | normalizar atributos Inkscape  |
| Paths             | crear/editar `d`, combine, break, reverse, simplify                          | híbrido           |        P1 | parser robusto, tolerancias    |
| Booleanas         | union, difference, intersection, exclusion, division, cut                    | actions           |        P1 | selección/orden determinista   |
| Conversión        | object/stroke/text to path                                                   | actions/CLI       |        P1 | irreversible; snapshot/warning |
| Transform         | move, scale, rotate, skew, flip, matrix, anchor                              | DOM               |        P1 | matrices anidadas y stroke     |
| Arrange           | align, distribute, z-order, reparent                                         | híbrido           |        P1 | bounds y referencia explícitos |
| Capas/grupos      | CRUD, label, visibilidad, lock, group/ungroup                                | DOM/actions       |        P1 | namespaces Inkscape            |
| Fill/stroke       | solid, none, opacity, joins, caps, dash, paint order                         | DOM               |        P1 | color parse/normalización      |
| Gradientes        | linear/radial, stops, spread, transforms, reuse                              | DOM               |        P1 | refs e IDs consistentes        |
| Patterns/markers  | crear, aplicar, reutilizar                                                   | DOM               |     P1/P2 | bbox/userSpaceOnUse            |
| Clip/mask         | crear, aplicar, quitar, inspeccionar                                         | DOM/actions       |        P1 | referencias y bounds           |
| Filtros           | blur, blend, shadow y primitives seleccionadas                               | DOM               |        P2 | diferencias de render          |
| Texto             | texto, tspans, estilo, spacing, anchor, dirección                            | DOM               |        P1 | fuentes y layout dependientes  |
| Texto avanzado    | text-on-path, flowed text, text-to-path                                      | híbrido           |     P1/P2 | SVG2/compatibilidad            |
| Imágenes          | colocar, embed, link local, relink, crop por clip                            | DOM               |        P1 | no red remota por defecto      |
| Bitmap trace      | trazado con presets allowlisted                                              | action/extensión  |        P2 | puede requerir GUI/extensión   |
| Símbolos/clones   | defs/use, clone/unlink, instancias                                           | DOM/actions       |        P2 | ciclos y referencias           |
| Guías/grids/snap  | leer/escribir configuración documental                                       | DOM               |        P2 | no depender de UI activa       |
| Live Path Effects | inspeccionar y subconjunto probado                                           | actions/DOM       |     P2/P3 | alto riesgo de versión/GUI     |
| Metadatos         | title, desc, RDF/license, author, keywords                                   | DOM               |        P1 | privacidad y namespaces        |
| Accesibilidad     | title/desc/ARIA básico, contraste como warning                               | DOM/preflight     |        P1 | no sustituye auditoría humana  |
| Colores           | inventario, reemplazo, paletas, perfiles referenciados                       | DOM/preflight     |     P1/P2 | no prometer CMYK fiable        |
| Optimización      | limpiar metadata/defs no usados, plain/optimized SVG                         | híbrido           |     P1/P2 | visual regression obligatoria  |
| Extensiones       | catálogo y adaptadores allowlisted                                           | CLI/extensión     |        P2 | nunca IDs arbitrarios públicos |
| Importación       | SVG/SVGZ/PDF/AI/EPS/EMF/WMF/DXF/raster según sonda                           | CLI/extensión     |     P1/P2 | opciones y plataforma          |
| Exportación       | PNG/PDF/SVG + PS/EPS/EMF/WMF/XAML gateados                                   | CLI               |     P0/P2 | validar cada artefacto         |

### 14.1 Diferencias que el resultado debe declarar

Toda operación que calcule geometría debe declarar `boundsMode`:

- `geometric`: geometría sin stroke/filter.
- `visual`: incluye stroke y efectos cuando Inkscape lo determine.
- `approximate`: estimación del motor JS; genera warning.

Las queries CLI x/y/width/height de Inkscape se consideran bounds visuales. No se etiquetan como `geometric` por omitir un flag: esa etiqueta requiere un motor geométrico compatible demostrado. Para imágenes bajo transform, reportar `dpiX`/`dpiY`; con skew/rotación, añadir el rango derivado de valores singulares y la fidelity del cálculo.

Toda operación sensible a fuentes debe indicar:

- fuentes solicitadas;
- fuentes detectadas/faltantes;
- si se preservó texto o se convirtió a paths;
- plataforma y versión de Inkscape usadas.

Toda operación de color avanzada debe indicar:

- color CSS normalizado;
- perfil referenciado si existe;
- ausencia de garantía CMYK/spot si la cadena no lo demuestra.

---

## 15. Diseño del adaptador de Inkscape

### 15.1 Descubrimiento del ejecutable

Orden de candidatos:

1. `--inkscape-bin` validado.
2. Variable `INKSCAPE_BIN` validada.
3. `inkscape`, `inkscape.com`, `inkscape.exe` en `PATH`.
4. Windows App Paths.
5. Registro de instalación/uninstall.
6. Paquetes AppX/MSIX cuyo manifiesto o VFS contenga Inkscape.
7. Rutas estándar Program Files/LocalAppData.
8. macOS app bundle y rutas habituales.
9. rutas Linux habituales.

Para cada candidato:

- comprobar que es archivo y no directorio;
- canonicalizar;
- ejecutar `--version` con timeout breve y captura real;
- verificar que la salida parsea como Inkscape;
- registrar tipo de instalación y restricciones;
- no aceptar el candidato solo porque existe.

Caso real que debe tener fixture de integración:

- MSIX `25415Inkscape.Inkscape` sin App Execution Alias;
- `inkscape.com` puede fallar con acceso denegado;
- `inkscape.exe` dentro del VFS funcionó en esta máquina para `--version`, `--help-all`, `--action-list` y `--list-input-types`;
- la ruta cambia con la versión y debe redescubrirse;
- si la política/ACL deja de permitir ejecución directa, `doctor` debe recomendar una instalación oficial CLI-friendly o una ruta explícita, no intentar saltarse ACLs.

### 15.2 Sonda de capacidades

Construir al inicio un `CapabilitySnapshot` cacheado por una huella completa, no solo ruta/versión/mtime:

```ts
type CapabilitySnapshot = {
  version: string;
  rawVersion: string;
  platform: string;
  installKind: "path" | "system" | "msix" | "app-bundle" | "unknown";
  fingerprint: {
    executableSha256: string;
    executableMtimeMs: number;
    profileId: string;
    dataDirsSha256: string;
    extensionsSha256: string;
    helperVersions: Record<string, string>;
  };
  probedAt: string;
  expiresAt: string;
  inputTypes: string[];
  outputTypes: string[];
  actions: Record<
    string,
    {
      description?: string;
      source: "core" | "extension" | "unknown";
      evidence: "declared" | "observed";
    }
  >;
  flags: Record<string, boolean>;
  warnings: string[];
};
```

La huella incluye ejecutable, perfil aislado, data dirs, INX/extensiones y helpers externos. El cache tiene TTL corto configurable y se invalida ante cualquier cambio. `--action-list` por sí solo no identifica de forma fiable si una acción viene del core o de una extensión: usar `unknown` salvo evidencia independiente y no elevar soporte a estable solo por la lista.

Sondas mínimas:

- `--version`;
- `--help-all` para flags reales;
- `--list-input-types`;
- `--action-list`;
- exportación controlada a cada formato principal desde un fixture mínimo;
- acciones críticas desde un fixture temporal;
- detección de extensiones necesaria solo para adaptadores opt-in.

La ayuda local de 1.4.4 confirma, entre otros:

- `--export-type=svg,png,ps,eps,pdf,emf,wmf,xaml`;
- `--export-area-page`, `--export-area-drawing`, `--export-area=x0:y0:x1:y1`;
- `--export-dpi`, `--export-width`, `--export-height`, `--export-margin`;
- `--export-page`, `--export-id`, `--export-id-only`;
- `--export-plain-svg`, `--export-text-to-path`;
- PDF 1.4/1.5 y PostScript 2/3;
- fondo/opacidad y controles PNG de modo, dithering, compresión y antialias;
- queries x/y/width/height/all;
- `--actions`, `--action-list`, `--actions-file`, `--shell` y `--batch-process`.

Acciones críticas observadas en 1.4.4 incluyen `object-to-path`, `object-stroke-to-path`, `path-union`, `path-difference`, `object-align`, `object-distribute` y `selection-ungroup`. No asumir que nombre/semántica son eternos: mapear por capability registry y fixtures.

### 15.3 Aislamiento de instancias

- Evitar depender de la ventana activa.
- Usar un app ID/tag único si la plataforma/versión lo soporta, para que una invocación no se entregue a una instancia GUI existente.
- Validar tags ASCII que no comiencen por dígito y produzcan un application ID válido.
- Asignar `INKSCAPE_PROFILE_DIR` aislado por worker/job; el app ID separa instancias, no preferencias ni recursos.
- Preferir procesos batch de vida corta en P0/P1.
- Evaluar `--shell` persistente solo en un benchmark posterior; complica concurrencia, recuperación y aislamiento.
- Separar stdout esperado de warnings GTK en stderr.
- Si una acción necesita `--with-gui`, declararla no-headless y excluirla del contrato estable hasta tener puente específico.
- Para secuencias extensas, evaluar `--actions-file` creado dentro de scratch para evitar límites de línea de Windows; usa la misma gramática insegura para valores libres, por lo que el contenido sigue limitado a acciones/argumentos allowlisted y remapeados.

### 15.4 Constructor de argumentos

Implementar una función pura por operación/formato:

```ts
buildPngExportArgs(spec, capabilities): readonly string[]
buildPdfExportArgs(spec, capabilities): readonly string[]
buildSvgExportArgs(spec, capabilities): readonly string[]
buildActionArgs(plan, capabilities): readonly string[]
```

Cada builder debe:

- aceptar solo tipos de dominio ya validados;
- producir orden determinista;
- rechazar combinaciones incompatibles;
- remapear IDs/operandos a IDs temporales seguros cuando una action use separadores y restaurar/mapping de IDs después;
- aplicar ese remapeo también a `--query-id`, `--select` (lista separada por comas), `--export-id` (lista separada por punto y coma) y parseo de `--query-all`;
- no conocer rutas sin resolver;
- ser cubierto por snapshots y pruebas de metacarácteres;
- retornar metadatos sobre flags efectivos y warnings.

---

## 16. Plan por fases y checklist ejecutable

### 16.0 Work packages y mini-puertas

Las fases son hitos; los work packages son la unidad de una sesión del modelo ejecutor. El rango incluye ambos extremos.

| Fase | Work packages                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| F00  | `F00-WP01` T01–T07; `WP02` T08–T15; `WP03` T16–T23                                                                 |
| F01  | `F01-WP01` T01–T04; `WP02` T05–T11; `WP03` T12–T18; `WP04` T19–T24; `WP05` T25–T28                                 |
| F02  | `F02-WP01` T00–T07; `WP02` T08–T14; `WP03` T15–T21; `WP04` T22–T25                                                 |
| F03  | `F03-WP01` T00–T06; `WP02` T07–T11; `WP03` T12–T17; `WP04` T18–T23                                                 |
| F04  | `F04-WP01` T01–T08; `WP02` T09–T13; `WP03` T14–T18                                                                 |
| F05  | `F05-WP01` T01–T07; `WP02` T08–T13; `WP03` T14–T20; `WP04` T21–T25; `WP05` T26–T29                                 |
| F06  | `F06-WP01` T01–T05; `WP02` T06–T10; `WP03` T11–T15; `WP04` T16–T22; `WP05` T23–T29; `WP06` T30–T35; `WP07` T36–T40 |
| F07  | `F07-WP01` T01–T05; `WP02` T06–T09; `WP03` T10–T17; `WP04` T18–T24; `WP05` T25–T31; `WP06` T32–T36; `WP07` T37–T40 |
| F08  | `F08-WP01` T01–T05; `WP02` T06–T10; `WP03` T11–T17; `WP04` T18–T24; `WP05` T25–T30; `WP06` T31–T34                 |
| F09  | `F09-WP01` T01–T06; `WP02` T07–T11; `WP03` T12–T17; `WP04` T18–T23; `WP05` T24–T26                                 |
| F10  | `F10-WP01` T01–T07; `WP02` T08–T13; `WP03` T14–T19                                                                 |
| F11  | `F11-WP01` T01–T07; `WP02` T08–T12; `WP03` T13–T16; `WP04` T17–T22; `WP05` T23–T25                                 |
| F12  | `F12-WP01` T01–T05; `WP02` T06–T10                                                                                 |

Corte de alcance Windows/stdio 1.0:

| Alcance       | Obligatorio para 1.0                                                        | Puede quedar `[w]`/`[-]` sin bloquear 1.0                                   |
| ------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| F00–F06 y F09 | Todos los WP; una capability concreta puede ser `[-]` solo si no se anuncia | Nada a nivel de WP                                                          |
| F07           | WP01–WP05; en WP06 son obligatorios T34–T35                                 | T16, T30, T32–T33, T36 y WP07 (T37–T40) son P2                              |
| F08           | WP01–WP02, WP04–WP05                                                        | WP03 (formatos secundarios) y WP06 (extensiones/optimize) son P2            |
| F10           | No                                                                          | Toda la fase; expansión 1.x                                                 |
| F11           | Sí                                                                          | Publicación externa puede ser `[w]`, pero el paquete local debe pasar gates |
| F12           | No                                                                          | Toda la fase                                                                |

`[-]` significa capability no anunciada/probada como ausente; `[w]` significa una decisión de alcance. Ninguno permite omitir tests de que la capability no aparece como soportada.

Mini-puerta obligatoria al cerrar cualquier WP (copiarla como checklist concreta en su subsección de progreso; no se marca globalmente aquí):

- Todas las tareas del rango están `[x]`, `[-]` con evidencia de capability no anunciada, o `[w]` autorizado.
- Pasan typecheck/lint y tests focalizados disponibles en ese punto; en F00-WP01 se usan verificaciones documentales equivalentes.
- No se rompen pruebas ya existentes.
- Contratos, fixtures y seguridad del WP están documentados.
- La subsección `FXX-WPYY` de `docs/progress/FXX.md` contiene comandos/resultados.
- El diff no adelanta el siguiente WP.

Una fase se cierra únicamente después de todos sus WP y de sus puertas `FXX-GYY`.

Orden lógico para el release Windows 1.0: F00 → … → F09 → F11. F10 es una expansión P2 que puede ejecutarse antes o después de F11 y se marca `[w]` en el corte 1.0 si se difiere; F12 siempre es posterior.

Antes de editar cada WP, completar esta ficha en `docs/progress/FXX.md`:

```markdown
## FXX-WPYY

- Objetivo verificable:
- Prerrequisitos/puertas:
- Interfaces disponibles (no inventar otras):
- Archivos/artefactos esperados:
- Tareas condicionales permitidas (`[-]`/`[w]`):
- No-objetivos:
- Comandos exactos:
- Assertions/tolerancias:
- Resultado:
```

Evidencia específica adicional para WP de alto riesgo:

| WP          | Evidencia que debe fijarse antes de implementar                             |
| ----------- | --------------------------------------------------------------------------- |
| F01-WP02/03 | fake process cases, timeout/kill assertion y candidatos discovery           |
| F02-WP01/02 | threat model, tabla de paths/races y política crash/locks                   |
| F02-WP03    | corpus XML, límites exactos y round-trip assertions                         |
| F02-WP04    | contrato de chunks, manifest del bundle nativo y carrera con writer externo |
| F03-WP01/03 | vectores normativos de §10 y tolerancias numéricas                          |
| F05-WP01    | atomicidad lógica/output revision/cancel stages                             |
| F05-WP02    | matriz PNG, megapíxeles y lectura IHDR                                      |
| F05-WP03    | ADR inspector/subset/margin + page count/boxes                              |
| F06-WP02    | gramática path completa y corpus reject/accept                              |
| F07-WP01/02 | operands, tolerancias y visual goldens por booleana                         |
| F09-WP01/04 | protocolo fijado `2026-07-28`, legacy y snapshot catálogo                   |
| F10-WP01    | Host/Origin/auth matrix y conformance fijada                                |

### F00 — Bootstrap, decisiones y baseline

**Objetivo:** crear una base reproducible sin implementar aún operaciones de diseño.

#### Repositorio y gobierno

- [x] `F00-T01` Confirmar con el usuario nombre público (`inkscape-mcp` recomendado), alcance de publicación y licencia. — Confirmado el 2026-08-25: `inkscape-mcp`, MIT y repositorio público.
- [x] `F00-T02` Inicializar Git sin alterar configuración global. — Inicializado con rama `main`.
- [x] `F00-T03` Crear `.gitignore`, `.gitattributes`, `.editorconfig` y política de finales LF/CRLF.
- [x] `F00-T04` Crear README mínimo que apunte a este plan y declare estado pre-alpha.
- [x] `F00-T05` Crear `LICENSE`, `SECURITY.md`, `CHANGELOG.md` y `CONTRIBUTING.md` según decisiones autorizadas.
- [x] `F00-T06` Crear `docs/progress/F00.md`.
- [x] `F00-T07` Hacer commit baseline solo si el usuario autorizó commits. — Commit inicial `f95a925`, autorizado por el usuario el 2026-08-25.

#### Toolchain

- [x] `F00-T08` Verificar Node 24 LTS y compatibilidad del SDK MCP v2; documentar rango en `engines`. — Node `24.18.0`, npm `11.16.0` y SDK MCP v2 `2.0.0`.
- [x] `F00-T09` Inicializar package ESM TypeScript con npm y lockfile.
- [x] `F00-T10` Instalar `@modelcontextprotocol/server`, Zod v4 y dependencias mínimas con versiones verificadas; añadir `@modelcontextprotocol/client` como devDependency para pruebas de negociación/transportes reales. — Dependencias fijadas en `package-lock.json`.
- [x] `F00-T11` Configurar TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` y source maps.
- [x] `F00-T12` Configurar lint, format y Vitest sin reglas contradictorias.
- [x] `F00-T13` Definir scripts `build`, `typecheck`, `lint`, `format:check`, `test`, `check`, `pack:check`; reservar `test:mcp`, `inspect` y `test:conformance` para herramientas dev fijadas en lockfile.
- [x] `F00-T14` Crear un binario mínimo `inkscape-mcp --help` y `--version` sin servidor funcional.
- [x] `F00-T15` Añadir prueba smoke del binario empaquetado.

#### ADRs

- [x] `F00-T16` ADR-001: TypeScript/Node 24/npm/ESM.
- [x] `F00-T17` ADR-002: arquitectura híbrida DOM + CLI/actions.
- [x] `F00-T18` ADR-003: stdio predeterminado y HTTP opt-in.
- [x] `F00-T19` ADR-004: rutas relativas, URIs opacas y roots configurados; no usar acceso global.
- [x] `F00-T20` ADR-005: revisiones SHA-256, locks, temporales, backups y commit atómico.
- [x] `F00-T21` ADR-006: política de errores, warnings y compatibilidad.
- [x] `F00-T22` Registrar licencias de dependencias y riesgos de paquetes nativos. — Inventario directo MIT/Apache-2.0 y postinstall de Inspector sin aprobar.
- [x] `F00-T23` ADR-007 y schema de manifest de fixtures: origen/licencia, versión, capability, assertions numéricas/estructurales/visuales y tolerancias por fixture.

#### Puerta F00

- [x] `F00-G01` `npm ci` funciona desde checkout limpio.
- [x] `F00-G02` `npm run check` pasa.
- [x] `F00-G03` `npm pack --dry-run` contiene únicamente archivos esperados.
- [x] `F00-G04` D001–D003 de la sección 20 están resueltas; cada decisión posterior tiene responsable, deadline y tarea/ADR, sin exigir resolver F02–F05 prematuramente.
- [x] `F00-G05` `docs/progress/F00.md` contiene evidencia.
- [x] `F00-G06` El manifest de fixtures prohíbe una tolerancia visual global vaga y exige aprobación explícita de cambios de golden.

---

### F01 — Configuración, doctor, discovery y runner

**Objetivo:** localizar y ejecutar Inkscape de forma segura y observable.

#### Configuración

- [x] `F01-T01` Implementar schema de config estricto y precedencia flags/env/file/defaults.
- [x] `F01-T02` Requerir al menos un workspace root para iniciar document tools; permitir `doctor` sin workspace y devolver `workspaceReady: false` sin acceder a documentos.
- [x] `F01-T03` Implementar redacción de config para logs/resultados.
- [x] `F01-T04` Probar valores inválidos, desconocidos, límites y combinación stdio/HTTP.

#### Runner

- [x] `F01-T05` Implementar `spawn` sin shell, argumentos array, cwd seguro y `windowsHide`.
- [x] `F01-T06` Implementar captura acotada e independiente de stdout/stderr, clasificación de truncamiento y drenaje sin deadlock.
- [x] `F01-T07` Implementar timeout, AbortSignal y cierre seguro del árbol: Windows Job Object/equivalente asociado al crear el hijo, terminación escalonada y prueba de nietos que ignoran la señal inicial. — Terminador de árbol Windows `taskkill /T /F` probado; Job Object para procesos desacoplados queda como hardening posterior documentado.
- [x] `F01-T08` Implementar semáforo global configurable.
- [x] `F01-T09` Implementar limpieza `finally` y tracking de PID solo interno.
- [x] `F01-T10` Crear fake Inkscape: éxito, error, timeout, salida enorme, output parcial, señal ignorada.
- [x] `F01-T11` Probar espacios, Unicode y metacarácteres en rutas/valores.

#### Discovery

- [x] `F01-T12` Implementar locator cross-platform con proveedores independientes.
- [x] `F01-T13` Implementar proveedor Windows PATH/App Paths/registro/rutas estándar.
- [x] `F01-T14` Implementar proveedor AppX/MSIX sin hardcodear versión/ruta.
- [x] `F01-T15` Implementar proveedores macOS/Linux, aunque CI real pueda llegar después.
- [x] `F01-T16` Validar cada candidato mediante el runner y parsear versión robustamente.
- [x] `F01-T17` Probar candidatos inexistentes, acceso denegado, ejecutable falso, versión no parseable y múltiples instalaciones.
- [x] `F01-T18` Añadir fixture/integ test para la instalación MSIX 1.4.4 observada.

#### Capabilities y doctor

- [x] `F01-T19` Parsear `--version`, `--help-all`, `--list-input-types` y `--action-list`.
- [x] `F01-T20` Crear snapshot/cache invalidable por ejecutable/hash/mtime, perfil, data dirs, INX/extensiones, helpers y TTL.
- [x] `F01-T21` Añadir sondas mínimas de exportación en scratch sin tocar workspace del usuario.
- [x] `F01-T22` Implementar `inkscape-mcp --doctor` con salida humana y `--json`.
- [x] `F01-T23` Diferenciar core action, extension action, origen `unknown`, flag ausente y capability experimental; `--action-list` solo produce evidencia observada, no clasificación fiable de origen.
- [x] `F01-T24` Documentar warnings GTK conocidos sin silenciar stderr desconocido.

#### Esqueleto MCP incremental y status

- [x] `F01-T25` Crear `buildServer()` y entrypoint `serveStdio(() => buildServer())` mínimos con SDK v2; el paquete v2 por sí solo no demuestra negociación MCP 2026.
- [x] `F01-T26` Establecer el patrón para que cada fase añada sus tools al catálogo estable y determinista.
- [x] `F01-T27` Implementar/registrar tool `inkscape_status` con output schema, `SecurityPosture`, capabilities y paths redactados.
- [x] `F01-T28` Probar stdio real con `versionNegotiation` fijado a `2026-07-28`, una pasada legacy soportada y stdout exclusivamente MCP.

#### Puerta F01

- [x] `F01-G01` `doctor` encuentra Inkscape 1.4.4 MSIX mediante discovery automático o explica de forma accionable por qué requiere ruta explícita. — En Windows, la integración real y `--doctor --json` detectan automáticamente el paquete MSIX 1.4.4, informan su origen `msix` sin exponer la ruta y superan la sonda PNG.
- [w] `F01-G02` Se capturan versión y ≥1000 acciones en el baseline local sin colgarse ni abrir flujo GUI dependiente. — Decisión explícita del usuario el 2026-08-30: no instalar otro baseline; se acepta el conteo real de 189 acciones observadas en MSIX 1.4.4 como evidencia de la sonda headless. El catálogo continúa declarando sólo esas 189, sin aliases sintéticos ni promesa de cobertura adicional.
- [x] `F01-G03` El fake demuestra timeout/cancelación/salida acotada sin procesos huérfanos. — El corpus del runner verifica tracker vacío después de timeout, aborto y límites independientes de stdout/stderr; en Windows inspecciona además que hijo y nieto reales ya no existen.
- [x] `F01-G04` Ninguna API pública acepta ejecutable, flags o comando arbitrarios. — Todos los `z.object` del catálogo MCP usan modo estricto, por lo que propiedades desconocidas se rechazan antes de handlers/runner; la auditoría stdio de 89 tools no encuentra executable/argv/args/flags/rawActions y la única propiedad `command` es el enum SVG `L|T`.
- [x] `F01-G05` Tests, lint y typecheck pasan; evidencia en `docs/progress/F01.md`. — `npm run check` desde el commit que endurece los schemas MCP completa formato, ESLint, TypeScript, build y Vitest: 75 archivos correctos, 1 omitido; 292 pruebas correctas y 1 omitida.
- [x] `F01-G06` Clientes MCP con negociación `2026-07-28` y legacy soportada llaman `inkscape_status` por stdio desde el binario construido. — El smoke inicia `node dist/cli.js` independientemente como `pinned-2026-07-28` y `legacy`; cada cliente lista el catálogo e invoca `inkscape_status` con contenido estructurado y postura de seguridad válida.
- [x] `F01-G07` Timeout/cancelación elimina hijo y nietos en Windows; no queda proceso tras una espera acotada y el test falla si solo muere el PID padre. — El fake crea una cadena padre→hijo→nieto y las pruebas Windows de timeout y `AbortSignal` consultan ambos PID tras la terminación por árbol `taskkill /T /F`.

---

### F02 — Workspace seguro, XML y transacciones

**Objetivo:** crear la frontera de seguridad y persistencia antes de editar diseños.

#### Workspace

- [x] `F02-T00` Cerrar threat-model ADR: cliente/documento hostil, supuestos sobre actor local, ACL de roots y riesgo residual TOCTOU.
- [x] `F02-T01` Implementar roots canónicos y IDs de workspace opacos.
- [x] `F02-T02` Implementar resolver de input existente con pertenencia robusta.
- [x] `F02-T03` Implementar resolver de output inexistente mediante parent canónico.
- [x] `F02-T04` Rechazar absolute/UNC/drive-relative/NUL/ADS/`..` y escapes de case/separadores.
- [x] `F02-T05` Probar symlink/junction/reparse point y carrera antes del commit. — `AtomicFileStore` congela los roots canónicos de runtime y vuelve a resolver los parents antes de staging y `rename`; una prueba Windows intercambia un directorio de salida por junction durante staging y confirma rechazo sin escribir fuera del workspace.
- [x] `F02-T06` Implementar allowlist de extensiones y sniffing inicial.
- [x] `F02-T07` Implementar paginación segura en `workspace_list_documents`.

#### Temporales, revisión y locks

- [x] `F02-T08` Implementar scratch/job dirs únicos y limpieza por éxito/fallo/arranque.
- [x] `F02-T09` Implementar SHA-256 streaming, `MutationDocumentRef` obligatorio y `expectedOutputRevision` para overwrite.
- [x] `F02-T10` Implementar lock por ruta canónica para documentos y destinos de output, con orden para evitar deadlocks.
- [x] `F02-T11` Implementar backup configurable y nombres sin colisión.
- [x] `F02-T12` Implementar commit atómico en Windows; documentar fallback y crash consistency.
- [x] `F02-T13` Implementar snapshots opacos, TTL/retención y tools snapshot/restore. — `document_snapshot`/`document_restore` usan IDs opacos owner-bound, TTL persistente, retención por workspace, revisión optimista y backup atómico.
- [x] `F02-T14` Probar dos writers concurrentes, revisión de documento/output obsoleta, cancelación y espacio insuficiente simulado. — Las pruebas de storage/runner cubren serialización, revisiones stale, abort/limpieza y `ENOSPC` sin publicación parcial.

#### XML/SVG

- [x] `F02-T15` Evaluar al menos dos parsers/DOM por fidelidad, seguridad, namespaces y licencia.
- [x] `F02-T16` Elegir parser mediante ADR y corpus de round-trip.
- [x] `F02-T17` Rechazar DTD/XXE/entity expansion y límites estructurales.
- [x] `F02-T18` Implementar inspección/sanitización de script/events/foreignObject/URLs externas y orden de confianza `strict < preserve-local < trusted`; el ceiling es solo config de arranque y ninguna tool puede elevarlo. — El bundle nativo deriva su modo del ceiling; las tools no exponen `trusted` y se eliminan URLs prohibidas también desde CSS/atributos de pintura.
- [x] `F02-T19` Preservar namespaces, `defs`, metadata, comentarios relevantes y referencias. — Corpus unitario cubre round-trip de namespaces, defs, metadata, comentarios y referencias locales.
- [x] `F02-T20` Implementar asignación/normalización de IDs sin romper `href`, CSS, clip/mask/filter/markers. — Utilidad determinista normaliza IDs públicos y reescribe href, ARIA, `url(#...)` y selectores CSS literales/escapados conocidos; duplicados se conservan semánticamente en la primera ocurrencia.
- [x] `F02-T21` Definir diff resumido semántico para mutaciones. — `summarizeSvgDiff` devuelve conteos y IDs añadidos/eliminados/cambiados/ambiguos sin incluir contenido SVG.

#### Artifact store mínimo

- [x] `F02-T22` Implementar `ArtifactStore` opaco sobre archivos autorizados/staging con metadata, ownership, TTL, `maxArtifactBytes` y límites separados; no devolver paths absolutos.
- [x] `F02-T23` Registrar handlers para `inkscape://artifact/{id}` y chunks inmutables acotados por `maxResourceReadBytes`; probar acceso, rangos, hash, expiración y aislamiento sin cargar el artefacto completo.
- [x] `F02-T24` Implementar `NativeInputBundle`: snapshot/hash del SVG y cada dependencia local en staging, URI reescritas, manifest reproducible y ejecución nativa solo contra esa copia.
- [x] `F02-T25` Probar writer externo que cambia source/dependencia/destino entre validación y commit, rechazo de downgrade de `sanitizeMode`, y rehash/revisión final antes de publicar.

#### Puerta F02

- [x] `F02-G01` Toda prueba de traversal/symlink/UNC/ADS queda rechazada sin tocar destino. — Los resolvedores de output rechazan traversal, drive-relative/absoluto, UNC, ADS, segmentos vacíos y `.` antes de IO; los tests verifican que el root no cambia y que un junction externo no recibe salida, además de la carrera de staging ya cubierta.
- [x] `F02-G02` Corpus SVG benigno cumple assertions/tolerancias por fixture del manifest; toda diferencia aceptada queda versionada con heatmap/razón. — El fixture first-party `benign-svg-sanitization` registra estructura segura, dimensiones y golden PNG por Inkscape 1.4.4; el smoke MCP compara source y sanitizado a 128×96 contra ese golden con cero píxeles/canales de tolerancia. No se acepta diferencia alguna, por lo que no hay excepción visual que versionar con heatmap/razón.
- [x] `F02-G03` Corpus XML malicioso falla de forma acotada. — El corpus rechaza DTD, entidades, CDATA, XML malformado, raíz incorrecta, exceso de bytes/elementos y profundidad; todo error de parseo se normaliza a `SvgSecurityError` sin exponer internals/documento y el smoke MCP prueba que DTD no publica output.
- [x] `F02-G04` Concurrencia/revisión/backup/commit atómico están probados. — Las pruebas cubren source/output stale, dos commits concurrentes con la misma revisión (uno publica, otro recibe conflicto), staging ENOSPC, rollback de lote nuevo y de outputs existentes tras fallo de rename, snapshots owner-bound y locks deterministas.
- [x] `F02-G05` Evidencia completa en `docs/progress/F02.md`. — El índice F02 mapea T00–T25 por WP a ADR/código/pruebas y separa las puertas cerradas de F02-G06–G08, que siguen pendientes sin presentarlas como evidencia suficiente.
- [x] `F02-G06` Un artefacto de fixture se publica/lee por URI opaca y otro workspace no puede accederlo. — El smoke stdio consume el recurso y un chunk desde `inkscape://artifact/{id}`; la prueba del store extrae el ID de esa URI sin root/owner, permite la lectura del owner emisor y rechaza `owner-b` con `RevisionConflictError`.
- [x] `F02-G07` Carreras symlink/junction deterministas se rechazan en tests y el ADR declara qué ataque local concurrente no cubre Node estándar. — Los commits individual y por lote intercambian el directorio destino por una junction durante staging, abortan antes de publicar fuera del root; ADR-008 declara el intervalo residual entre el último recheck y `rename` que requiere helper nativo/sandbox.
- [x] `F02-G08` Una exportación usa un bundle de inputs consistente o devuelve conflicto; nunca mezcla revisiones de SVG/dependencias. — El bundle copia/hash el SVG y assets antes de Inkscape y cada exportación llama `assertCurrent` antes de publicar; la carrera determinista que cambia ambos tras staging devuelve `RevisionConflictError` y conserva únicamente la copia original coherente.
- [x] `F02-G09` El cliente no puede seleccionar `trusted` ni un modo menos restrictivo que el ceiling de arranque; el intento deja evento auditado sin contenido sensible. — Los cinco schemas MCP de importación rechazan `trusted` antes de IO/publicación; el smoke stdio verifica el rechazo sin output y emite el evento fijo `sanitize_mode_trusted_rejected`, sin rutas, documento, workspace ni valor de cliente.

---

### F03 — Documentos, unidades, viewBox y páginas

**Objetivo:** resolver de forma fiable la prioridad principal de tamaños.

#### Modelo geométrico

- [x] `F03-T00` Cerrar ADR de `viewBoxPolicy`, escala/origen, coordinate spaces, IDs sintéticos/persistentes, motor/subconjunto CSS, fidelidad `exact|partial|approximate` y vectores normativos de la sección 10 antes de implementar resize.
- [x] `F03-T01` Implementar `PhysicalLength`, `CssPixelLength`, `PageSize`, `UserPoint/UserRect`, matrices entre espacios y conversiones de viewport a 96 dpi.
- [x] `F03-T02` Definir precisión/redondeo y pruebas de ida/vuelta.
- [x] `F03-T03` Separar viewport físico, `viewBox`, user units y bounds del contenido.
- [x] `F03-T04` Implementar anchors y transform matrices para resize.
- [x] `F03-T05` Definir bounds `geometric|visual|approximate`: las queries CLI de Inkscape se tratan como visuales; bounds geométricos requieren motor compatible probado o se declaran aproximados.
- [x] `F03-T06` Probar coordenadas negativas, transforms anidados, stroke, markers, filters, specificity, `!important`, `currentColor`, variables, porcentajes, `objectBoundingBox` y non-scaling stroke.

#### Crear/inspeccionar documento

- [x] `F03-T07` Implementar SVG mínimo válido con namespaces Inkscape opcionales.
- [x] `F03-T08` Implementar presets de página versionados y schema custom.
- [x] `F03-T09` Implementar `document_create` con una o múltiples páginas.
- [x] `F03-T10` Implementar inspección base: dimensiones, viewBox, unidades, páginas, revisión.
- [x] `F03-T11` Manejar documentos sin width/height, sin viewBox o con porcentajes mediante warnings/normalización explícita.

#### Resize y páginas

- [x] `F03-T12` Implementar `page_only`.
- [x] `F03-T13` Implementar `scale_content_contain`.
- [x] `F03-T14` Implementar `scale_content_cover` y warning de crop.
- [x] `F03-T15` Implementar stretch solo opt-in.
- [x] `F03-T16` Implementar fit page to drawing/selection con márgenes por lado.
- [x] `F03-T17` Implementar crop/expand y cambio de orientación.
- [x] `F03-T18` Implementar adapter `pages_v14` para root + `inkscape:page` dentro de namedview, con namespaces y round-trip 1.4.4.
- [x] `F03-T19` Implementar `dryRun` con tamaño/transform/diff previstos.
- [x] `F03-T20` Implementar list/add/update/delete/reorder de páginas por ID estable.
- [x] `F03-T21` Validar solapamiento, páginas vacías y objetos fuera de páginas.
- [x] `F03-T22` Registrar tools `document_resize` y `document_pages`.
- [x] `F03-T23` Implementar/registrar `document_settings` para inspeccionar/editar de forma tipada `pagecolor`, `pageopacity`, desk y border, con defaults por versión y round-trip.

#### Puerta F03

- [x] `F03-G01` A4 mide 210 × 297 mm y round-trip conserva medidas dentro de tolerancia definida. — El smoke stdio crea A4 mediante el preset, lo exporta con Inkscape como SVG Inkscape y vuelve a inspeccionarlo; exige unidades `mm` y 210 × 297 mm con tolerancia absoluta de 0,01 mm por eje.
- [x] `F03-G02` `page_only` no cambia transform/geometry de elementos. — Las pruebas unitarias y el smoke MCP comparan todos los atributos de los hijos SVG antes/después: grupo con transform anidado, `rect` geométrico transformado y `path` con `d` y matriz permanecen idénticos; sólo cambian viewport/viewBox.
- [x] `F03-G03` contain/cover/fit producen bounds y anchors esperados en fixtures. — Los vectores unitarios fijan contain/cover 800 × 600 → 1080 × 1080 en `top_left` y `bottom_right`; el smoke MCP confirma las matrices `contain`/`cover`, el warning de crop y el fit por bounds nativos con márgenes. Las comparaciones numéricas usan tolerancia absoluta de 0,01 en el adapter nativo y 12 decimales en el modelo puro.
- [x] `F03-G04` Multipágina conserva IDs/referencias tras CRUD y reorder. — El vector unitario y el smoke MCP ejecutan add → update → reorder → delete → list sobre páginas `page_*`; verifican ID/label/rectángulo final, orden estable y preservación de guía y referencia `inkscape:current-page` en namedview.
- [x] `F03-G05` Mutaciones rechazan revisión obsoleta y producen backup/revision/diff. — `document_resize` devuelve siempre diff semántico acotado, tanto dry-run como mutación publicada; el smoke MCP confirma backup, revisión nueva, igualdad del diff previsto/publicado y rechazo de una revisión stale sin cambio de hash.
- [x] `F03-G06` Evidencia y previews comparativos en `docs/progress/F03.md`. — `npm run evidence:f03` reproduce cuatro PNG mediante las tools MCP `document_resize` y `document_render_preview`; el manifiesto versionado fija dimensiones, modos y SHA-256.
- [x] `F03-G07` Los cinco vectores normativos de la sección 10 pasan con tolerancias numéricas fijadas en el ADR. — ADR-010 fija comparación de 12 decimales para los modelos puros y conserva 0,01 unidades para observaciones nativas parciales; pruebas focalizadas cubren A4 user-scale/viewBox, contain, cover y fit negativo.
- [x] `F03-G08` Escalar contenido preserva el subconjunto CSS declarado o rechaza sin mutar; fixtures difíciles reportan fidelidad/pérdidas exactas. — `document_resize` informa `contentFidelity`/`contentLimitations`; CSS simple type/id/class conserva cascade, mientras combinadores, variables, porcentajes geométricos, `objectBoundingBox` y non-scaling stroke rechazan antes del commit.
- [x] `F03-G09` Settings de página round-trip y el modo de fondo PNG `document` usa esos valores sin confundir desk con página. — Smoke MCP por stdio persiste y relee page/desk/border, exporta una página vacía y verifica RGBA de cada píxel contra `pageColor/pageOpacity`, con `deskColor` contrastante.

---

### F04 — Inspección, preflight y preview

**Objetivo:** que el modelo comprenda el diseño y sus riesgos antes de modificar/exportar.

#### Inspección

- [x] `F04-T01` Inventariar elementos por tipo, ID, layer, visibilidad y lock.
- [x] `F04-T02` Reportar bounds globales y por página. — `document_inspect(includeVisualBounds=true)` consulta `--query-all` con revisión fijada y devuelve unión global e intersecciones por página con fidelidad parcial.
- [x] `F04-T03` Inventariar fills, strokes, gradientes, patterns, filters y opacidades. — Inventario acotado de atributos/estilos inline y defs; no afirma estilos CSS computados.
- [x] `F04-T04` Inventariar fuentes/estilos y detectar faltantes mediante un font resolver probado; si no existe esa capability, devolver `FONT_RESOLUTION_UNAVAILABLE` y no afirmar ausencia. — Devuelve familias declaradas y `FONT_RESOLUTION_UNAVAILABLE`, sin afirmar presencia/ausencia.
- [x] `F04-T05` Inventariar imágenes linked/embedded, dimensiones y rutas redactadas. — Tipo, display y PNG IHDR intrínseco acotado sin exponer href/ruta/payload.
- [x] `F04-T06` Detectar IDs duplicados, refs rotas, recursos externos y namespaces desconocidos.
- [x] `F04-T07` Añadir paginación/filtros para documentos grandes. — `inventoryKinds`, límite/offset, `nextOffset`, total y truncamiento estable.
- [x] `F04-T08` Completar `document_inspect` con niveles `summary|standard|deep`.

#### Preflight

- [x] `F04-T09` Perfil `web`: externos, scripts, fonts, raster grande, viewBox, IDs y accesibilidad básica. — Inspección segura de recursos, a11y básica, fuentes no resolubles, raster PNG embebido y referencias/IDs sin abrir links.
- [x] `F04-T10` Perfil `print`: tamaño físico, `BleedSpec` explícito por lado y separado de margen/crop marks, fuentes, filtros rasterizados, imágenes efectivas y warnings de color. — Bleed físico tipado por lado, DPI conservador de PNG embebido y warnings explícitos de fuentes/filtros/color.
- [x] `F04-T11` Perfil `interchange`: plain SVG, features Inkscape, flow text, LPE, external refs y compatibilidad. — Advierte características Inkscape, flow text, LPE, refs y SVG avanzado sin convertir ni prometer portabilidad.
- [x] `F04-T12` Códigos/severidad/remediation estables y documentados.
- [x] `F04-T13` Tool `document_preflight` sin mutar documento.

#### Preview

- [x] `F04-T14` Implementar `ExportAreaNormalizer` reutilizable y render PNG a scratch por page/drawing/selection; F05 debe extender este pipeline, no duplicarlo. — Módulo puro con áreas tipadas y preview nativo de página, drawing o una selección validada.
- [x] `F04-T15` Limitar dimensiones, bytes, duración y transparencia. — PNG transparente, máximo 2048 por eje solicitado/verificado, tamaño de artefacto, runner con timeout y staging.
- [x] `F04-T16` Inline solo por debajo de `maxInlineBytes`; si no, devolver resource link. — Devuelve `resource_link` opaco para previews grandes; los chunks del artefacto mantienen sus límites.
- [x] `F04-T17` Cache por revision + spec, con invalidación y TTL. — Caché controlada de 10 minutos por revisión, área normalizada, dimensiones, transparencia y versión Inkscape.
- [x] `F04-T18` Tool/resource de preview y metadatos. — `document_render_preview` incluye área, cache, metadatos PNG y artefacto/recurso opaco.

#### Puerta F04

- [x] `F04-G01` Inspección de corpus cubre todos los inventarios con paginación estable. — El smoke stdio `test:f04-g01` cubre inventario deep de defs, imágenes, capas, fuentes, namespaces, referencias y tipos, comprueba que no filtra texto ni URIs, y verifica tres páginas `rect` estables con `nextOffset` acotado.
- [x] `F04-G02` Preflight detecta fixtures deliberadamente defectuosos sin falsos éxitos críticos. — El smoke stdio `test:f04-g02` cubre SVG negativo web, impresión, intercambio y XML inválido; fija códigos, severidades, detalle tipado de bleed/DPI, ausencia de filtraciones y que los defectos críticos dejan `valid=false`.
- [x] `F04-G03` Preview coincide en tamaño/área/transparencia y respeta límites. — El smoke stdio `test:f04-g03` decodifica previews de página, drawing y selección, fija sus dimensiones/colores/alfa, verifica cache hit reproducible y comprueba el rechazo de una dimensión mayor a 2048 px.
- [x] `F04-G04` Ninguna lectura modifica mtime/contenido del diseño. — El smoke stdio `test:f04-g04` fija y compara hash/mtime de un SVG antes y después de `document_inspect` deep con bounds nativos, `document_preflight` y `document_render_preview`; los tres preservan el original mientras preview publica sólo su derivado.
- [x] `F04-G05` Evidencia en `docs/progress/F04.md`. — Las puertas G01–G04 tienen smokes stdio independientes y reproducibles; el cierre F04 registra su alcance, comandos, resultados y límites declarados sin ampliar el contrato.

---

### F05 — Exportación MVP: PNG, PDF y SVG

**Objetivo:** entregar la prioridad de exportación con validación fuerte.

#### Motor común

- [x] `F05-T01` Implementar la unión discriminada de §11 por formato: PNG-only sizing/background/custom area; PDF filter DPI/pages; PS/EPS constraints; selection `combined|each|selected-only`; rechazar toda combinación cruzada. — `exportSpecSchema` discriminado y probado.
- [x] `F05-T02` Extender/reutilizar `ExportAreaNormalizer` y staging/cancelación de F02/F04 para tamaño/margen/páginas; no crear un segundo pipeline PNG. — Área tipada compartida y pipeline común de etapas/cleanup/cancelación; planificador múltiple se conecta en F05-WP05.
- [x] `F05-T03` Implementar `OutputTarget`, lock de destino, overwrite=false y staging; overwrite exige hash esperado. — Targets tipados seguros; `AtomicFileStore` existente conserva lock, staging y revisión obligatoria para overwrite.
- [x] `F05-T04` Implementar builders puros de argv. — Builder común allowlisted por formato/área.
- [x] `F05-T05` Implementar progress stages y cancelación del pipeline. — Etapas ordenadas y `AbortSignal` propagable al adaptador.
- [x] `F05-T06` Implementar verificadores por formato y manifest común. — Dispatcher estructural para PNG/PDF/SVG y manifest común; formatos sin verifier quedan gateados.
- [x] `F05-T07` Extender el `ArtifactStore` de F02 con metadata/verificación de export y lifecycle de lotes. — Metadata validada y batch opaco con rollback best-effort.

#### PNG

- [x] `F05-T08` Exportar page/drawing/selection/custom. — `export_png` normaliza las cuatro áreas tipadas y verifica que la selección exista antes de ejecutar Inkscape.
- [x] `F05-T09` Implementar width/height/DPI con precedencia y ratio. — DPI no se mezcla con dimensiones; width/height mantienen ratio salvo `allowDistortion` explícito y el PNG verificado debe coincidir.
- [x] `F05-T10` Implementar fondo `document|transparent|solid`, opacidad y snap; `document` usa settings de F03 y no toma el color de desk. — El fondo de documento usa `pagecolor`/`pageopacity`; solid y transparencia pasan flags allowlisted y snap solo se activa explícitamente.
- [x] `F05-T11` Capability-gate color mode/dithering/compression/antialias. — Las cinco opciones avanzadas, incluido snap, se solicitan a `CapabilityService`; una instalación que no las anuncia devuelve un error recuperable sin ejecutar flags especulativos.
- [x] `F05-T12` Verificar firma, IHDR, dimensiones, modo, bytes y hash. — `verifyPng` prueba firma/IHDR, width/height esperados, bit depth, color type, pHYs opcional, longitud y SHA-256.
- [x] `F05-T13` Probar transparencia, fondos, 8/16 bit y paths Unicode. — La prueba MCP real exporta PNG 8-bit y transparente RGBA_16 con dithering, compresión, antialias, snap y destino Unicode; los unitarios cubren los builders y las incompatibilidades de color mode/bit depth.

#### PDF

- [x] `F05-T14` Ejecutar spike/ADR: elegir inspector PDF JS, confirmar que 1.4.4 separa `--export-page`, fijar estrategia prune (direct solo por capability futura; merge como último fallback), tolerancias de boxes y fixture de `viewBox` con origen no cero. — ADR-011 fija `pdf-lib` MIT, sonda 1.4.4, tolerancia 0.6 pt y los fixtures `pdf-multipage.svg`/`pdf-nonzero-viewbox.svg`.
- [x] `F05-T15` Implementar opciones PDF 1.4/1.5, text-to-path, filter DPI/ignore y LaTeX; margen queda capability-gated por sonda y usa expansión temporal si el flag falla; normalizar una copia temporal a origen cero cuando la sonda detecte el problema de PDF con `viewBox` no cero. — Version/text/filter/LaTeX usan flags allowlisted y capability gate; `--export-filter-dpi` se rechaza en 1.4.4. El margen se aplica en una copia temporal con caja validada (el flag nativo no se anuncia como fiable), y la sonda de `viewBox` desplazado no justificó normalización en esta build.
- [x] `F05-T16` Implementar PDF multipágina completo sin asumir semántica errónea de `--export-page`. — En 1.4.4 la exportación de documento no añade `--export-page`; la prueba MCP real verifica un PDF de dos páginas y declara estrategia `full_document`.
- [x] `F05-T17` Implementar subset a PDF único por poda de SVG temporal en 1.4.4; habilitar direct solo por capability futura y unión externa únicamente si la poda no preserva semántica. — La copia inmutable se poda por IDs seguros antes de la exportación y el PDF resultante se verifica contra el número solicitado, con estrategia `prune_subset`.
- [x] `F05-T18` Implementar exportar páginas separadas con nombres deterministas. — `export_pdf_pages` poda cada página en una copia SVG inmutable y publica `page-NNN.pdf` según el índice original de la página; la integración MCP verifica dos PDFs separados, incluso solicitados en orden inverso.
- [x] `F05-T19` Verificar firma, versión, page count, orden, boxes, bytes y hash, incluido `pdf-nonzero-viewbox.svg` contra el problema conocido 6323. — `verifyPdf` valida cabecera/parseo y devuelve estos metadatos; la integración MCP comprueba orden de subset con tamaños de página distintos y MediaBox/CropBox 284 × 142 pt (tolerancia 0.6 pt) para el fixture con `viewBox` desplazado.
- [x] `F05-T20` Detectar artefactos secundarios LaTeX y publicarlos como grupo lógicamente atómico. — `latex=true` verifica y publica `output.pdf` y `output.pdf_tex` mediante `AtomicFileStore.commitBatch`; fallos manejados restauran miembros ya publicados y la prueba MCP real lee el sidecar no vacío.

#### SVG

- [x] `F05-T21` Exportar SVG Inkscape y plain SVG; probar el `viewBox` grande/512 del problema conocido 6317 y aplicar solo una corrección temporal validada si la build lo reproduce. — Ambos modos usan el builder allowlisted, el artefacto valida XML/seguridad/viewBox/hash/bytes y la integración MCP confirma que plain SVG preserva `0 0 512 512`; esta build no reproduce 6317.
- [x] `F05-T22` Implementar selection-only como documento autónomo mediante cierre transitivo de `defs`, `href`, CSS heredado/calculado, fuentes e imágenes; detectar ciclos, remapear IDs/refs y declarar pérdidas si se opta por aplanar estilos. — El extractor conserva dependencias locales transitivas y assets publicados; para el subconjunto CSS auditado materializa la cascada heredada en estilos inline y elimina reglas ajenas, mientras que selectores/at-rules/variables no soportados preservan el stylesheet con warning de fidelidad parcial.
- [x] `F05-T23` Implementar text-to-path opcional con warning.
- [x] `F05-T24` Verificar XML, namespaces, refs, IDs y política externa. — `verifySvg` exige namespace SVG explícito, `viewBox` válido, IDs públicos únicos y cierre de `href`, ARIA y `url(#id)` tanto en atributos como CSS; la sanitización preserve-local rechaza recursos externos antes de publicar.
- [x] `F05-T25` Evaluar SVGZ real; gatear si no existe soporte validado. — Sonda directa de Inkscape 1.4.4 (`--help`) lista `svg,png,ps,eps,pdf,emf,wmf,xaml` y no `svgz`; ninguna tool pública ofrece SVGZ ni se presenta la extensión como soporte disponible.

#### Batch

- [x] `F05-T26` Implementar `document_export`. — Tool unificado de un archivo para PNG, PDF base, SVG y SVG plano, con `ExportSpec`, bundle nativo inmutable, verificación y artefacto MCP; las opciones especializadas conservan sus tools hasta ser incorporadas de forma equivalente.
- [x] `F05-T27` Implementar `document_export_batch` con `best_effort` y `all_or_nothing`. — Hasta cincuenta variantes base de una misma revisión se planifican sin colisiones; pruebas MCP reales cubren publicación conjunta y rollback manejado de `all_or_nothing`, además de fallo aislado/publicación válida de `best_effort`.
- [x] `F05-T28` Implementar colisiones, límites, progreso, cancelación y commit lógico `directory_rename|manifest_commit`, con limpieza/rollback best-effort documentados. — Los lotes `all_or_nothing` publican un receipt final `manifest_commit` bajo `.inkscape-mcp-commits/`; sus variantes y el marker entran al mismo `commitBatch`, y una falla manejada al mover el marker revierte todo output ya publicado. Scratch se limpia en `finally`; un crash de proceso puede dejar archivos físicos sin marker, que no se anuncian como lote publicado.
- [x] `F05-T29` Añadir presets A4 print, web PNG, plain SVG e icon pack mínimo. — `document_export_batch` acepta exactamente un `preset` o `specs`, expande print A4 PDF, web PNG de 1200 px, SVG plano e iconos 16–512 px a variantes normales y crea su directorio de salida dentro del workspace mediante validación por segmento.

#### Puerta MVP F05

- [x] `F05-G01` A4 a 300 dpi produce 2480 × 3508 px según política documentada. — La prueba MCP crea un fixture A4 independiente, exporta página a 300 dpi y verifica IHDR 2480 × 3508 con Inkscape 1.4.4.
- [x] `F05-G02` PNG transparente y con fondo validan dimensiones/píxeles esperados. — El smoke stdio `test:f05-g02` exporta un SVG con PNG transparente y sólido semitransparente, decodifica ambos para fijar 10 × 10 px, alfa de esquina, color de fondo y foreground rojo, y confirma que el SVG no cambia.
- [x] `F05-G03` PDF multipágina conserva el número y tamaños de páginas esperados. — El smoke stdio `test:f05-g03` exporta el fixture multipágina con Inkscape, comprueba respuesta MCP y PDF reabierto con `pdf-lib`: dos páginas, MediaBox/CropBox 284 × 142 y 142 × 142 pt dentro de 0,6 pt, y fuente sin cambios.
- [x] `F05-G04` SVG y plain SVG reabren en Inkscape y pasan validación estructural/visual. — El smoke stdio `test:f05-g04` exporta ambos sabores de un SVG con capa editable, valida XML/namespace/viewBox y elementos, vuelve a abrirlos en Inkscape para previews de 200 × 120 px y fija cero píxeles distintos frente al maestro con tolerancia de un canal.
- [x] `F05-G05` Publicación/rollback/reinicio verificables. — `test:f05-g05` combina la inyección de interrupción al mover el receipt final (rollback de todos los outputs), recuperación de scratch obsoleto y un lote real por stdio que publica el directorio `.inkscape-mcp-commits/`, receipt `manifest_commit` y hashes de cada miembro. Un corte abrupto de energía fuera del proceso no se anuncia como atomicidad ni borra archivos sin receipt de procedencia verificable.
- [x] `F05-G06` Timeout/cancelación no dejan output parcial ni proceso huérfano. — `test:f05-g06` combina el árbol real hijo/nieto del runner Windows, timeout/abort, un batch MCP cancelado sin output ni manifest publicado y un reinicio que elimina scratch de job obsoleto e invalida el job/resource efímero anterior. La cola durable local es el único mecanismo de persistencia entre reinicios.
- [x] `F05-G07` Paths con espacios/Unicode/metacarácteres no alteran argv. — La prueba MCP exporta `salida ñ; & segura.png`, comprueba la firma PNG publicada y confirma que el nombre llega a Inkscape como path, no como shell.
- [x] `F05-G08` Inspector MCP ejecuta status/create/resize/preview/export por stdio. — `test:f05-g08` usa exclusivamente el launcher CLI fijado del Inspector contra procesos `dist/cli.js` por stdio; encadena status, workspace, create, resize, preview y PNG con revisiones opacas, y verifica la firma del archivo publicado.
- [x] `F05-G09` Evidencia completa en `docs/progress/F05.md`; MVP demostrable de extremo a extremo. — `test:f05-g09` crea un SVG, lo redimensiona de 8 × 3 a 10 × 4 cm, lo inspecciona y publica preview, PNG, PDF y SVG plano desde la misma revisión por MCP stdio; vuelve a abrir el PDF y verifica firmas/namespace de los tres entregables.
- [x] `F05-G10` Un PDF subset (páginas 1 y 3 de un fixture de tres) produce un solo archivo con exactamente dos páginas, orden y boxes correctas; el manifest declara estrategia `direct|prune|merge`. — `test:f05-g10` solicita `page_one,page_three` del fixture de tres páginas, comprueba exactamente dos páginas 284 × 142 y 142 × 142 pt (MediaBox/CropBox, tolerancia 0,6 pt) en respuesta y PDF reabierto, y fija `strategy: "prune_subset"`/`PDF_SUBSET_PRUNED` como la ruta `prune` declarada.
- [x] `F05-G11` SVG selection-only reabre sin refs rotas, conserva apariencia dentro de tolerancia y no incorpora objetos ajenos a su cierre transitivo. — `test:f05-g11` rasteriza con Inkscape casos CSS materializado con gradiente y contextual con ancestro; ambos tienen cero píxeles distintos con tolerancia de un nivel y cero IDs/referencias rotas. Confirma que definiciones/objetos no transitivos no se incluyen y que la multiselección contextual declara fidelidad parcial en vez de prometer apariencia exacta.
- [x] `F05-G12` PDF con `viewBox` de origen no cero conserva MediaBox/CropBox y apariencia esperadas; el manifest registra si se normalizó una copia temporal. — `test:f05-g12` exporta/reabre el fixture `viewBox="20 30 100 50"`, fija MediaBox/CropBox de 284 × 142 pt (tolerancia 0,6), reimporta mediante la tool PDF controlada y compara cero píxeles distintos. La build 1.4.4 no requiere normalización temporal y no declara ese warning.
- [x] `F05-G13` Plain SVG con dimensión/viewBox 512 conserva el valor correcto y reabre visualmente; ninguna workaround se aplica a builds no afectadas. — `test:f05-g13` exporta/reabre el fixture cuadrado como SVG plano, fija root/namespace, `width`/`height` y `viewBox="0 0 512 512"`, y compara cero píxeles distintos a 256 px con tolerancia de un canal. La build local no declara workaround de viewBox y la fuente conserva su hash.

---

### F06 — Motor de elementos y diseño básico

**Objetivo:** permitir diseño vectorial cotidiano sin exponer XML o acciones crudas.

#### Selectores e inventario

- [x] `F06-T01` Definir `ElementSelector` por ID/IDs/tipo/layer/clase y subconjunto CSS seguro, alineado con el motor CSS/ADR de F03. â€” `elements_query` acepta un compuesto estricto de tipo/ID/hasta ocho clases; no acepta combinadores, atributos ni pseudoselectores.
- [x] `F06-T02` Limitar complejidad de selector, cantidad de matches y profundidad. â€” Longitud 256, ocho clases, 10.000 coincidencias y profundidad DOM 128; pruebas unitarias y MCP ejecutadas el 2026-08-25.
- [x] `F06-T03` Implementar orden documental determinista y paginación.
- [x] `F06-T04` Implementar `elements_query` con atributos, estilo computable, parent/layer y bounds; remapear IDs para `--query-id`/`--query-all` y probar IDs con coma, punto y coma, whitespace, Unicode y controles rechazados. â€” `includeBounds=true` crea una copia nativa temporal con IDs seguros y un mapa reversible; IDs duplicados no reciben bound para evitar atribución errónea. La prueba MCP cubre coma, punto y coma, espacio y Unicode; los controles son rechazados por los schemas públicos. `includeComputedStyle=true` resuelve presentación, CSS compuesto seguro, inline, herencia y `!important`; CSS no soportado se declara como fidelidad parcial, no como verdad calculada.
- [x] `F06-T05` Diferenciar elemento inexistente de selector vacío válido.

#### Creación

- [x] `F06-T06` Crear rectángulo y rounded rect.
- [x] `F06-T07` Crear círculo/elipse.
- [x] `F06-T08` Crear line/polyline/polygon.
- [x] `F06-T09` Crear star/regular polygon/spiral compatibles con Inkscape o SVG estándar según modo. — Star/polígono se serializan como `<polygon>` y spiral como `<path>` SVG estándar de espiral de Arquímedes, con turnos/radio/rotación acotados; pruebas unitarias y MCP reales cubren su creación.
- [x] `F06-T10` Elegir e implementar un parser/validador read-only completo de path `d` (M/L/H/V/C/S/Q/T/A/Z, límites y finitud) y crear paths solo después de validarlos.
- [x] `F06-T11` Crear texto/tspan básico.
- [x] `F06-T12` Crear imagen local linked/embedded detrás de política. — `elements_create` resuelve sólo raster local dentro del workspace, verifica firma PNG/JPEG/GIF/WebP y límite de tamaño; publica href relativo o data URI raster Base64 seguro.
- [x] `F06-T13` Crear group y layer con label/ID.
- [x] `F06-T14` Implementar ID generation, collision policy y reescritura de refs. — IDs automáticos deterministas evitan colisiones; IDs explícitos en colisión se rechazan. `document_normalize_ids` realiza la renormalización explícita y reescribe href/URL/ARIA/CSS locales con manifiesto de cambios.
- [x] `F06-T15` Implementar `elements_create` con batch acotado.

#### Update/delete/duplicate/group

- [x] `F06-T16` Implementar patch de geometría/atributos allowlisted por tipo.
- [x] `F06-T17` Implementar texto básico sin aceptar markup inseguro.
- [x] `F06-T18` Implementar delete explícito y cascade/ref policy. — Antes de borrar, recorre el subárbol destino y rechaza referencias vivas a cualquiera de sus IDs mediante href/xlink, `url(#…)` en atributos y CSS, o ARIA; el commit no se alcanza en un rechazo.
- [x] `F06-T19` Implementar duplicate independiente y clone `<use>` como operaciones distintas. — `elements_duplicate` copia subárboles de hasta 1.000 elementos/256 IDs y remapea cada ID local de forma determinista; reescribe sólo refs internas `href`, `url(#…)`, ARIA y CSS. IDs origen ambiguos o no seguros exigen `document_normalize_ids`; `mode=use` conserva el clone explícito sin copiar el subárbol.
- [x] `F06-T20` Implementar group/ungroup/reparent con orden estable. — `elements_group` conserva hijos y `elements_reparent` mueve una selección en orden documental a un group/layer existente, rechazando ciclos y selección ancestro-descendiente.
- [x] `F06-T21` Implementar z-order: front/back/raise/lower/index/relative-to. — `elements_arrange` conserva lotes en orden documental y admite `index` determinista (tras retirar la selección) y `before`/`after` contra un hermano explícito, sin aceptar índices negativos, referencias seleccionadas ni padres distintos.
- [x] `F06-T22` Registrar tools update/delete/duplicate/group. — `elements_update`, `elements_delete`, `elements_duplicate` y `elements_group` tienen schemas estrictos, revisión esperada y commit atómico.

#### Transformaciones y arrange

- [x] `F06-T23` Implementar translate/scale/rotate/skew/flip/matrix.
- [x] `F06-T24` Definir anchor/origin por bbox, página, coordenada o elemento. — `elements_align` acepta como referencia el bbox unido de la selección, una página explícita (o el viewBox si no hay páginas), una coordenada o el bbox visual de otro elemento; obtiene los bounds de Inkscape con revisión esperada.
- [x] `F06-T25` Preservar o aplanar transforms solo según opción explícita. — `elements_transform` conserva transforms; `elements_flatten_transform` es la operación explícita que incorpora transformaciones axis-aligned en geometría de primitivas. Rechaza rotación/skew, paths, transforms heredados, CSS stroke y stroke no uniforme antes de alterar el documento.
- [x] `F06-T26` Implementar align left/center/right/top/middle/bottom. — `elements_align` calcula traslaciones individuales desde bounds visuales nativos, conserva los transforms existentes y rechaza selecciones con ancestro y descendiente.
- [x] `F06-T27` Implementar distribute edges/centers/gaps. — `elements_distribute` ordena de forma estable por el eje, conserva los extremos y distribuye bordes, centros o gaps de manera determinista.
- [x] `F06-T28` Implementar remove overlaps como capability separada. — `elements_remove_overlaps` usa bounds visuales nativos, orden estable por eje/ID y traslaciones forward-only; mueve sólo pares que se solapan en el eje perpendicular, admite gap 0–10.000 y no une, recorta ni altera paths. Una selección sin solapes devuelve la revisión original sin backup.
- [x] `F06-T29` Probar nested transforms, negative scale, text/image y stroke scaling. — Pruebas unitarias cubren composición translate+scale con espejo, texto trasladado, imagen reflejada, escalado de stroke uniforme y rechazos seguros para stroke no uniforme, rotación y transforms anidados/heredados.

#### Estilo básico

- [x] `F06-T30` Parsear/normalizar colores CSS seguros. — Pintura directa acepta solamente `none` o `#rrggbb`, normaliza hexadecimal a minúsculas y no acepta CSS arbitrario.
- [x] `F06-T31` Aplicar fill/stroke/opacity/fill-rule. — Parches tipados cubren fill/stroke, opacidad global y por pintura, y fill-rule.
- [x] `F06-T32` Aplicar width/cap/join/miter/dash/paint-order. — Soporta ancho, cap, join, miter limit, dash array acotado y paint-order allowlisted.
- [x] `F06-T33` Aplicar visibilidad/display/lock y clases con política. — `visibility`, `display`, lock Inkscape y hasta 32 clases CSS identificadoras únicas se validan y serializan tipadamente.
- [x] `F06-T34` Aplicar typography básica: family, size, weight, style, anchor, spacing. — Incluye family, size, normal/bold o 100–900, style, anchor y letter/word spacing finitos.
- [x] `F06-T35` Implementar herencia/cascada sin sobrescribir estilos no relacionados. — Las propiedades se escriben como atributos SVG individuales: un patch sólo altera las claves solicitadas, preservando los demás atributos y la cascada de estilos existente.

#### Transacción multioperación

- [x] `F06-T36` Definir unión discriminada versionada `DesignOperation`. — `document_apply_operations` acepta una unión estricta y acotada de create/update/transform/arrange/group/duplicate/reparent/delete, sin XML, CSS, paths ni comandos arbitrarios.
- [x] `F06-T37` Implementar `document_apply_operations` all-or-nothing. — Cada operación transforma el SVG en memoria y hay un único commit con revisión esperada tras completar todas; una operación inválida no escribe el resultado parcial.
- [x] `F06-T38` Permitir referencias a IDs creados antes dentro de la misma transacción mediante aliases locales. — `create.aliases` registra aliases locales de IDs creados explícitamente; update, transform, arrange, group, duplicate, reparent y delete resuelven `@alias` sólo dentro de esa transacción. Group y duplicate también pueden publicar un alias de su nuevo ID; los aliases duplicados o no definidos rechazan toda la transacción.
- [x] `F06-T39` Implementar `dryRun` que valida y resume sin escribir. — `dryRun` ejecuta el mismo pipeline y retorna diff semántico, número de operaciones y la revisión original sin commit.
- [x] `F06-T40` Limitar operaciones, matches y costo estimado. — Límite estricto de 50 operaciones y 100 objetivos por operación; cada respuesta incluye `estimatedCost` determinista en unidades de objetos, sin prometer tiempo de render.

#### Puerta F06

- [x] `F06-G01` Un único workflow crea una composición con layer, formas, texto, imagen, estilos y grupos. — Recorrido MCP real construye `f06-gate.svg` con una capa, rectángulo, texto, imagen linked, patch de estilo, grupo y transformación.
- [x] `F06-G02` Transform/align/distribute coincide con bounds esperados en fixtures. — El fixture de composición confirma el rectángulo transformado en `(6,8)` y el fixture de layout confirma distribución `0,20,40` seguida de alineación a `x=30`, mediante `--query-all` nativo.
- [x] `F06-G03` Una operación inválida en el medio revierte toda la transacción. — La integración MCP inserta una creación seguida de delete inexistente; la solicitud falla y la siguiente mutación sólo acepta la revisión anterior.
- [x] `F06-G04` IDs y referencias permanecen válidos tras duplicate/group/reparent/delete. — La integración cubre copy/use, copia profunda con `remappedIds`, group/reparent/delete y después inspecciona cero `duplicateIds` y cero `unresolvedReferences`.
- [x] `F06-G05` Visual regression pasa en Inkscape 1.4.4 dentro de tolerancia. — Los PNG del workflow MCP y del SVG equivalente de referencia se comparan con tolerancia de un canal y cero píxeles distintos.
- [x] `F06-G06` Evidencia en `docs/progress/F06.md`.

---

### F07 — Paths, defs, tipografía, imágenes y diseño avanzado

**Objetivo:** cubrir las familias avanzadas que hacen del servidor una herramienta de diseño y no solo de composición básica.

#### Paths

- [x] `F07-T01` Extender el parser de F06 a AST mutable preservando comandos relativos/absolutos, subpaths y precisión documentada. — `parseSvgPathData` entrega segmentos y arrays `values` mutables; conserva case, subpaths y moveto implícito, con serialización determinista documentada.
- [x] `F07-T02` Añadir límites/tolerancias avanzados para edición, booleanas y serialización estable. — `SVG_PATH_LIMITS` limita longitud, segmentos y magnitud numérica; no aproxima geometría y canoniza `-0`. Los goldens PNG de booleanas aceptan sólo una unidad por canal.
- [x] `F07-T03` Implementar combine/break-apart/reverse. — `paths_combine` concatena paths del mismo padre sólo con presentación idéntica y sin refs vivas; `path_break_apart` exige IDs nuevos; `path_reverse` conserva ID/estilo e invierte líneas, curvas, smooth commands y arcos. Las pruebas positivas y negativas cubren estilo y referencias.
- [x] `F07-T04` Implementar union/difference/intersection/exclusion. — `paths_boolean` ejecuta acciones nativas headless allowlisted sobre exactamente dos IDs en staging, sanea y comitea atómicamente. Los cuatro fixtures visuales cubren su geometría; para `difference`, `ids[0]` es el objetivo e `ids[1]` el cortador.
- [x] `F07-T05` Implementar division/cut/split/fracture donde capabilities lo confirmen. — la instalación baseline confirma `path-division` y `path-cut`; ambas se ejercitan por MCP con `ids[0]` como objetivo. Split/fracture no aparecen en la lista de acciones y no se anuncian.
- [x] `F07-T06` Implementar simplify, flatten, inset/outset/dynamic offset como operaciones diferenciadas y gateadas. — `path_modify` ejecuta sólo `simplify` tras confirmar `path-simplify`; las solicitudes legacy inset/outset/offset devuelven un error recuperable porque las actions no existen. `paths_flatten` publica `path-flatten` para 2–100 paths, sin simular capability.
- [x] `F07-T07` Implementar object-to-path y stroke-to-path con snapshot y warning irreversible. — `objects_to_paths` limita targets a shapes/path vectoriales, usa staging nativo, revisión/backup/diff y `confirmIrreversible`; el smoke MCP cubre stroke-to-path real.
- [x] `F07-T08` Controlar orden/selección, remapear IDs inseguros antes de actions y devolver el mapping/IDs resultantes sin interpolar valores libres. — Las actions exigen exactamente los IDs públicos solicitados, paths distintos, y en operaciones direccionales `ids[0]` debe estar debajo de `ids[1]`. El bundle nativo normaliza IDs inválidos/duplicados antes de hashearse y devuelve `renamed` tipado.
- [x] `F07-T09` Probar self-intersections, holes, evenodd/nonzero, arcs, transforms y tolerancias. — El cliente MCP real ejecuta fixtures de auto-intersección, hueco nonzero, arcos y transformación; las cuatro booleanas de área mantienen sus golden PNG con tolerancia de un canal.

#### Defs y pintura avanzada

- [x] `F07-T10` CRUD de linear/radial gradients y stops. — `gradients_manage` crea, actualiza, aplica o borra gradientes lineales/radiales con 2–64 stops ordenados y colores tipados. La eliminación rechaza referencias vivas; las pruebas unitarias y MCP cubren create/apply/update.
- [x] `F07-T11` Gradient units/transforms/spread y reutilización. — `gradients_manage` valida unidades, spread y matriz desde su CRUD original, y ahora permite `href` local al gradient del mismo tipo sin duplicar stops; rechaza IDs inseguros, destinos ausentes y ciclos.
- [x] `F07-T12` CRUD de patterns y aplicación con transforms. — `patterns_manage` crea/actualiza/aplica/elimina patrones tipados de dots/stripes, con colores hex estrictos, unidades y matriz invertible; bloquea borrados con refs SVG/CSS activas. Pruebas unitarias y MCP por stdio verificadas.
- [x] `F07-T13` CRUD de markers start/mid/end. — `markers_manage` crea/actualiza/aplica/elimina flechas y puntos tipados, con color/tamaño/orientación/unidades validadas, para `line`, `path`, `polygon` y `polyline`; protege referencias activas. Pruebas unitarias y MCP por stdio verificadas.
- [x] `F07-T14` Crear/aplicar/liberar clip paths y masks. — `clips_manage` y `masks_manage` crean recursos rectangulares tipados, los aplican/liberan sobre IDs explícitos y evitan borrar referencias SVG/CSS activas; las máscaras usan una región opaca de espacio de usuario sin admitir markup arbitrario. Pruebas unitarias y MCP por stdio verificadas.
- [x] `F07-T15` Detectar y limpiar defs no usados mediante plan/dryRun antes de vacuum. — `defs_vacuum` produce por defecto un plan no mutante y sólo borra recursos directos de `<defs>` cuando se confirma con revisión; conserva referencias SVG/CSS y dependencias indirectas. Pruebas unitarias y MCP por stdio cubren plan y confirmación.
- [x] `F07-T16` Implementar filtros seleccionados: blur, drop shadow, blend y color matrix con schemas tipados. — `filters_manage` crea/reemplaza/aplica/libera/elimina recursos locales sin XML libre; la eliminación rechaza referencias activas en atributos o CSS y las cuatro primitivas tienen schemas cerrados. Pruebas unitarias y MCP por stdio cubren el ciclo seguro.
- [x] `F07-T17` Preservar filtros desconocidos aunque no se puedan editar. — El saneador conserva `filter`/primitivas locales y sus refs `url(#id)` sin exponer edición XML libre; prueba unitaria cubre un filtro desconocido de dos primitivas y sigue rechazando URLs externas.

#### Texto

- [x] `F07-T18` Editar contenido/tspans conservando estructura o reemplazándola según modo explícito. — `text_manage` exige `preserve_structure` con número exacto de segmentos o `replace_structure` con líneas/tspans tipados; no recibe markup.
- [x] `F07-T19` Soportar multiline, baseline, letter/word spacing, direction y writing mode cuando SVG/Inkscape lo permitan. — El modo de reemplazo crea líneas SVG mediante tspans y el patch admite baseline, text-anchor, spacing, direction y writing-mode; pruebas unitarias y MCP verifican ambos modos.
- [x] `F07-T20` Crear/quitar text-on-path y mantener refs. — `text_path_manage` adjunta o libera un `<textPath href="#id">`, preservando contenido y tspans; IDs de texto/path son estrictos. Las pruebas unitarias y el smoke MCP cubren attach/detach; referencias complejas continúan explícitamente fuera del contrato.
- [x] `F07-T21` Inspeccionar flowed text y ofrecer conversión gateada. — `flowed_text_inspect` está acotado y no publica IDs inseguros; `flowed_text_convert` acepta sólo un flowRoot inequívoco, plano y de una región, conserva propiedades tipográficas seguras y publica `FLOWED_TEXT_LAYOUT_LOST`. Flows ricos/complejos se rechazan atómicamente; el fixture MCP convierte y renderiza el resultado nativo sin prometer preservar wrapping o fidelidad tipográfica.
- [x] `F07-T22` Descubrir fuentes del sistema de forma acotada y cacheada. — `fonts_list` usa la colección de fuentes instalada en Windows o fontconfig en Unix, no expone rutas y mantiene una caché de cinco minutos.
- [x] `F07-T23` Preflight de fuente ausente/sustitución y limitaciones de incrustación. — `fonts_preflight` compara familias declaradas con la caché, distingue genéricas y advierte explícitamente que cobertura de glifos, sustitución de métricas y permisos de incrustación no se verifican.
- [x] `F07-T24` Convertir texto a paths como operación irreversible documentada. — `text_to_paths` requiere IDs explícitos, revisión y `confirmIrreversible: true`; usa la acción nativa de Inkscape en una copia staged, sanea el resultado y publica un warning irreversible. Pruebas MCP verifican el flujo.

#### Imágenes y recursos

- [x] `F07-T25` Place linked local con path autorizado y URI relativa segura. — `elements_create` acepta imágenes sólo mediante `assetPath` del workspace y calcula un `href` relativo; no acepta URI remota ni ruta absoluta.
- [x] `F07-T26` Embed data URI con MIME/tamaño/dimensiones validados. — `elements_create` valida firma raster y límite de bytes antes de producir data URI PNG/JPEG/GIF/WebP.
- [x] `F07-T27` Relink/embed/extract sin escapar del workspace. — `images_manage` relinka o incrusta sólo assets canonizados del workspace, y extrae data URI hacia una salida con extensión/MIME validada mediante commit batch atómico.
- [x] `F07-T28` Crop no destructivo mediante clip path. — `images_crop` crea un `clipPath` local de espacio de usuario, preserva el `href` y la geometría de la imagen, exige IDs/revisión/coordenadas tipados y rechaza reemplazar implícitamente un clip existente; pruebas unitarias y MCP por stdio verificadas.
- [x] `F07-T29` Calcular DPI efectivo por transform como `dpiX`/`dpiY`; para skew/rotación reportar también rango por valores singulares y fidelity, nunca un único escalar engañoso. — `images_inspect_dpi` inspecciona PNG embebidos sin leer links, acumula transforms y devuelve `dpiX`/`dpiY`; ante skew/rotación calcula rango conservador con valores singulares y marca fidelidad explícita.
- [x] `F07-T30` Bitmap trace detrás de capability/preset allowlist y límites de costo. — `images_trace` usa exclusivamente `object-trace` confirmado en el baseline, con preset fijo `default`, una sola imagen local/embebida, confirmación irreversible y máximo de 4 megapíxeles antes del proceso nativo. No acepta actions, extensiones, parámetros ni URLs libres; el smoke MCP ejecuta el trace real y rechaza presets ajenos.
- [x] `F07-T31` No descargar URLs; ofrecer error/remediación para recurso remoto. — `resources_inspect_remote` detecta refs HTTP/HTTPS/file/protocol-relative en atributos o CSS sin descargarlas ni exponer el URL, e indica usar `images_manage` con un asset local del workspace.

#### Otros objetos avanzados

- [x] `F07-T32` Símbolos y `<use>`/clones con cycle detection. — `symbols_manage` lista, crea y elimina símbolos, y crea clones posicionados; solo permite referencias locales seguras y rechaza ciclos o IDs ausentes antes de mutar.
- [x] `F07-T33` Guías y grids documentales sin depender de preferencias globales. — `guides_grids_manage` inspecciona y hace CRUD tipado de guías y `xygrid` en `sodipodi:namedview`, sin tocar configuración global de Inkscape.
- [x] `F07-T34` Metadata title/desc/RDF/license con sanitización. — `metadata_manage` edita title, desc y licencia como texto acotado y sanitizado, y publica el subconjunto RDF cerrado `dc:title`, `dc:description`, `dc:rights`, `dc:creator` y `dc:subject`/`rdf:Bag`; no acepta RDF/XML, URIs ni namespaces aportados por el cliente. Las pruebas unitarias y MCP verifican su persistencia y que el saneador no elimina el resultado.
- [x] `F07-T35` Accesibilidad básica y warnings de contraste/orden solo como heurística. — `metadata_manage` establece `aria-label`, `aria-hidden`, title y desc; `accessibility_inspect` añade contraste de texto directo contra un `pagecolor` opaco conocido o blanco de fallback, y orden documental como heurísticas, con sus limitaciones explícitas.
- [x] `F07-T36` Investigar LPE; publicar únicamente subconjunto headless con smoke tests. — `path_effects_inspect` expone hasta 1.000 efectos locales y sus referencias locales acotadas, sin devolver IDs/tipos anómalos; `path_effects_manage` desadjunta paths o borra efectos locales sin uso con revisión/backup. El smoke MCP renderiza con Inkscape un documento que preserva LPE antes de mutarlo. La edición de parámetros permanece fuera del catálogo, por no tener contrato headless fiable.

#### Cobertura avanzada adicional

- [x] `F07-T37` Implementar edición de nodos tipada: insertar/mover/eliminar, cambiar comando, handles, abrir/cerrar subpath y mantener índices/revisión. — `path_node_move` mueve endpoints M/L/H/V/T/Q/C/S/A y normaliza comandos relativos a SVG absoluto equivalente; `path_node_edit` inserta/elimina/retaggea L/T, abre/cierra subpaths, edita handles Q/C y parámetros A, y expande S/T a C/Q equivalentes antes de editar handles. Los índices son de segmento canónico local y no cambian al añadir transforms al elemento; pruebas unitarias y MCP verifican la revisión, el índice y la transformación preservada.
- [x] `F07-T38` Inspeccionar/preservar mesh gradients y gatear su edición hasta tener modelo y fixtures fiables. — `mesh_gradients_inspect` informa IDs, filas, patches y referencias sin serializar ni editar geometría; la edición continúa fuera del catálogo hasta contar con modelo/fixtures.
- [x] `F07-T39` Modelar conectores/diagramas como paths + markers + referencias, preservando semántica Inkscape cuando exista. — `connector_create` publica una polilínea con `inkscape:connector-type`, `connector_retarget` cambia endpoints locales y `connector_route` calcula ruta ortogonal por centros para rect/circle/ellipse, transformaciones axiales y hasta 20 obstáculos explícitos con clearance. `elements_transform` y updates geométricos reencaminan automáticamente hasta 100 conectores compatibles ligados a los endpoints movidos; los no compatibles conservan su ruta explícita sin simular seguimiento.
- [x] `F07-T40` Implementar inventario/aplicación de paletas y swatches documentales sin depender de preferencias globales. — `palette_inspect` inventaría colores hex locales en atributos, estilos inline, CSS documental, variables y swatches sólidos nombrados de Inkscape; `palette_apply` reemplaza un mapa directo `from`/`to` en esos destinos, todos los stops de gradientes multistop y valores que alimentan `currentColor`, con revisión y backup. No interpreta colores funcionales, perfiles o recursos externos.

#### Puerta F07

- [x] `F07-G01` Union/difference/intersection/exclusion pasan sus fixtures geométricos/visuales; division/cut pasan al estar anunciados y split/fracture no se anuncian. — El smoke MCP renderiza y compara los cuatro booleanos con fixtures PNG; también ejecuta division/cut reales gateados por la capability del baseline.
- [x] `F07-G02` Gradients/patterns/markers/clip/mask sobreviven save/reopen/export. — El smoke MCP exporta un SVG combinado con los cinco recursos locales, verifica que conserva sus definitions y lo reabre/renderiza mediante Inkscape.
- [x] `F07-G03` Texto conserva o convierte editabilidad según request y reporta fuentes. — Las pruebas MCP cubren estructura de text/tspan, text-on-path, flowed text con warning de pérdida, fuentes/preflight y conversión nativa irreversible a paths.
- [x] `F07-G04` Linked/embed/crop de imágenes respeta roots y dimensiones. — Las pruebas MCP cubren asset local, embed/extract atómico, crop por clip, DPI y bitmap trace con límite de costo; los resolvers rechazan URLs y rutas fuera del workspace.
- [x] `F07-G05` Ninguna operación destructiva avanzada ocurre sin snapshot/revisión/warning. — Las herramientas destructivas de paths, texto, defs, imágenes y LPE exigen revisión, commit atómico/backup y confirmación o warning cuando aplica; los negativos MCP comprueban revisión, confirmación y preset inválido.
- [x] `F07-G06` Evidencia en `docs/progress/F07.md`. — WPs F07-WP01–WP07 y esta puerta registran contratos, límites, pruebas unitarias, smoke MCP y deuda explícitamente no anunciada.

---

### F08 — Importación, formatos adicionales, presets y paquetes

**Objetivo:** ampliar interoperabilidad sin volver variable o inseguro el núcleo.

#### Importación normalizada

- [x] `F08-T01` Diseñar pipeline `externo -> SVG temporal -> inspección -> incorporación/publicación`. — SVG/SVGZ, raster y PDF producen SVG acotado, inspeccionado/saneado y pasan por `publishImportedSvg`, que publica SVG y manifest sidecar en un único commit. PDF ejecuta sólo una copia staged y revalida la revisión antes y después del proceso nativo; raster es un wrapper SVG interno byte-sniffed.
- [x] `F08-T02` Usar `--list-input-types` runtime como fuente de verdad. — `document_import_capabilities` expone el resultado observado del probe local; el adaptador PDF exige que `pdf` esté anunciado antes de invocar Inkscape y sus flags dependen de la ayuda observada. Raster no invoca un importador nativo: se mantiene explícitamente como adaptador interno byte-sniffed, por lo que ninguna extensión o tipo anunciado amplía su allowlist.
- [x] `F08-T03` Implementar SVG/SVGZ con sanitización/preserve modes. — `document_import` cubre SVG y SVGZ: valida cabecera gzip, limita el tamaño comprimido y descomprimido, aplica el máximo de política configurado y publica únicamente SVG saneado; conserva el importador SVG previo por compatibilidad.
- [x] `F08-T04` Implementar raster place/embed con sniffing y límites. — `document_import_raster` acepta BMP/TIFF/TGA no comprimidos y PNG/JPEG/GIF/WebP sólo tras identificar bytes y dimensiones, limita input y megapíxeles y publica SVG con embed o link relativo + manifest atómico; no descarga recursos ni confía en la extensión.
- [x] `F08-T05` Implementar PDF interno con `--pages` y estrategias de fuente allowlisted. — `document_import_pdf` exige PDF local, página única y `--pages`; permite sólo las seis estrategias que anuncia el CLI local y las gatea por capabilities antes de invocar Inkscape.
- [x] `F08-T06` Implementar PDF Poppler como modo distinto y advertir glyphs/rasterización. — El modo `poppler` requiere `--pdf-poppler`, prohíbe estrategias internas y devuelve la advertencia explícita `PDF_POPPLER_GLYPH_EDITABILITY_LIMITED`; ambos modos se verifican por stdio con PDF real.
- [x] `F08-T07` Gatear AI/EPS/PS/EMF/WMF/XAML/DXF y otros según sonda real. — `document_import_capabilities` parte de `--list-input-types`, mantiene AI/WMF/XAML/DXF y otros como `detected-but-blocked`, y habilita EPS/PS/EMF sólo tras sondas controladas de conversión headless. Los adaptadores publicados no aceptan formatos ni argumentos nativos libres, requieren firma/estructura, staging, revisión y SVG saneado + manifest.
- [x] `F08-T08` Detectar importadores que abren diálogo/requieren GUI y marcarlos no-headless. — La sonda aislada EPS/PS ejecuta el fixture fijo en scratch mediante el runner único: sólo un SVG real devuelve `validated`/`available`; fallo, timeout o ausencia de salida queda `not-headless`/`detected-but-blocked`. Los formatos sin fixture siguen `not-validated` y bloqueados.
- [x] `F08-T09` Probar archivo corrupto, password/encrypted, huge pages, zip bomb y dependencia ausente. — SVGZ limita expansión, raster rechaza cabeceras truncadas/corruptas, PostScript rechaza firma corrupta antes de ejecutar/publicar y `document_import_pdf` rechaza `/Encrypt`, páginas ausentes y páginas por encima de 200in/50.000.000pt² antes de invocar Inkscape o publicar outputs. Los importadores nativos registran fuente/perfil del SVG resultante, advierten las limitaciones y permiten rechazar fuentes ausentes o ICC sin declarar antes del commit.
- [x] `F08-T10` Implementar `document_import` con manifest de conversión/pérdidas. — SVG/SVGZ, raster y PDF publican sidecar atómico con schema/hash/bytes, `removed`, warnings cuando corresponden y una lista uniforme `losses`: saneamiento SVG, wrapper raster o fidelidad/edición PDF.

#### Exportaciones adicionales

- [x] `F08-T11` PS level 2/3 con preflight de transparencia/filtros. — `document_export` permite PS 2/3 únicamente con argv derivado de `ExportSpec`; el preflight detecta filtros, máscaras y opacidad. Por defecto rechaza antes de ejecutar; `rasterize-with-warning` exige aceptación explícita y declara la pérdida.
- [x] `F08-T12` EPS con área de dibujo/temporal recortado; no usar área de página no soportada. — EPS acepta exclusivamente drawing/selection desde schema, verifica cabecera y BoundingBox concreto y el smoke real exporta/reimporta el resultado mediante el adaptador seguro EPS.
- [x] `F08-T13` EMF con flatten/preflight y round-trip fixture. — `document_export` admite EMF sólo tras validar su `ENHMETAHEADER` y preflight de filtros/máscaras/opacidad; la política por defecto rechaza y `flatten-with-warning` requiere aceptación explícita. `document_import_emf` exige la misma firma, staging/revisión, SVG saneado y manifest. La capability se valida mediante fixture interno SVG→EMF→SVG y el smoke repite el round-trip público.
- [x] `F08-T14` WMF como compatibilidad experimental con warning fuerte. — `document_export` admite sólo WMF de área drawing/selection con el mismo preflight de flattening y validación de cabecera WMF/Placeable WMF. Devuelve siempre `WMF_EXPERIMENTAL_COMPATIBILITY`; no se publica un importador WMF sin round-trip y verificador de entrada aprobados.
- [-] `F08-T15` XAML mediante capability de extensión y fixtures WPF/Avalonia. — La sonda local confirma que Inkscape conoce XAML, pero esta máquina no dispone de runtime WPF capaz de parsearlo ni de un consumidor Avalonia. Sin dos fixtures de consumidor no se publica exportación XAML ni se confunde la extensión con compatibilidad.
- [-] `F08-T16` SVG optimizado con adaptador opcional/Scour detectado, visual regression y manifest. — `scour` no está instalado/detectable en el entorno; no se expone un optimizador ni se sustituye por una transformación no equivalente. La exportación SVG plana existente sigue siendo el camino soportado.
- [-] `F08-T17` Explorar JPG/WebP/TIFF solo como extensiones detectadas; no anunciar sin prueba. — El doctor confirma JPEG/TIFF como tipos de entrada (ya cubiertos por `document_import_raster`), pero el help de salida local no anuncia JPG/WebP/TIFF ni se detectó un exportador adicional verificable. No se publica ninguna salida raster adicional.

#### Presets y workflows

- [x] `F08-T18` Schemas versionados para page/export/workflow presets. — Export presets usan `inkscape-mcp-export-preset/v1`, las recetas conservan `inkscape-mcp-recipe/v1` y las definiciones reutilizables usan `inkscape-mcp-export-preset-definition/v1`; todos son objetos strict y acotados.
- [x] `F08-T19` Resolver herencia sin ciclos y overrides estrictos. — El resolver de definiciones rechaza IDs duplicados, padre ausente y ciclos; sólo mezcla `text`, `widthPx` y `heightPx` tipados. Los presets publicados restringen texto a impresión y tamaño exacto a social.
- [x] `F08-T20` Preset icon pack multi-size. — `icon-pack` expande PNG de 16, 24, 32, 48, 64, 128, 256 y 512 px con nombres deterministas; pruebas unitarias y smoke MCP real verifican las ocho variantes en un lote `all_or_nothing`.
- [x] `F08-T21` Preset web asset (SVG plano + PNG 1x/2x/3x). — `web-asset-pack` expande a SVG plano y PNG transparentes de 1200, 2400 y 3600 px mediante el mismo lote verificado que las exportaciones explícitas.
- [x] `F08-T22` Preset print PDF con filtro 300 dpi, texto configurable y preflight. — `print-pdf-300dpi` fija PDF con `filterRasterDpi: 300`; el override tipado `text: preserve|paths` elige el tratamiento de texto y `document_export_preset_plan` ejecuta preflight `print`, devuelve sus warnings y bloquea errores antes de emitir token.
- [x] `F08-T23` Presets sociales con metadata de fecha/fuente y custom override. — `social-square`, `social-landscape` y `social-story` producen PNG transparentes deterministas; requieren fecha ISO y etiqueta de fuente, permiten sólo pares acotados width/height y conservan la metadata en plan y manifest.
- [x] `F08-T24` Implementar protocolo de dos pasos para presets: `document_export_preset_plan` hace preflight, devuelve `planToken`/digest ligado a sourceRevision, spec normalizado, capabilities observadas y TTL; `document_export_batch` exige y consume el token una sola vez, y vuelve a comprobar revisión fuente y huella de capabilities antes de renderizar.

#### Packaging de assets

- [x] `F08-T25` Analizar dependencias locales de imágenes/CSS/fuentes/perfiles. — El bundle nativo recorre referencias `href`, `src`, CSS `url()` y `@import`, resuelve sólo archivos locales bajo el workspace y conserva su revisión.
- [x] `F08-T26` Copiar/embed según política sin escapar roots. — La política publicada es copiar únicamente: cada dependencia se cuarentena, limita y copia bajo `assets/`; no hay modo de embed que oculte la procedencia.
- [x] `F08-T27` Reescribir referencias relativas y comprobar reapertura. — Las referencias pasan a `assets/...`; la prueba MCP abre el documento empaquetado y lo renderiza mediante Inkscape real.
- [x] `F08-T28` Crear package + manifest + hashes en staging. — `document.svg`, assets y `manifest.json` se generan en staging, se revalidan y se publican con commit por lote; el manifiesto contiene revisiones SHA-256.
- [x] `F08-T29` No redistribuir fuentes/assets sin comprobación/licencia explícita. — Cada URI requiere una licencia no vacía, única y exacta; faltantes, duplicadas o sobrantes fallan antes de publicar.
- [x] `F08-T30` Implementar `assets_package`. — Tool MCP con schema estricto, roots canónicos, revisión esperada, manifest y prueba positiva/negativa real.

#### Ecosistema de extensiones y optimización

- [~] `F08-T31` Descubrir exporters INX desde directorios de datos, parsear sus manifests de forma segura y validarlos con export real; no existe un `--list-output-types` simétrico fiable. — Se descubren INX sólo desde directorios internos, con máximo de archivos y lectura previa acotada en bytes; XML malformado, DTD/entidades e IDs inválidos se descartan sin exponer paths/IDs como inputs. El doctor informa únicamente el conteo. DXF, HPGL, FXG y SIF tienen smoke por adapter; la sonda GPL, igual que varias raster, no produce un artefacto verificable; los demás permanecen no anunciados hasta su propia prueba.
- [x] `F08-T32` Definir adapter versionado para outputs de extensión y evaluar DXF, HPGL/PLT, G-code y raster adicionales solo si están instalados y son headless. — DXF, HPGL, FXG y SIF quedan disponibles sólo por adapters fijos `inkscape-dxf/v1`/`inkscape-hpgl/v1`/`inkscape-fxg/v1`/`inkscape-sif/v1`, con smoke real y verificación estructural. La instalación no declara PLT; G-code no declara output y pide directorio/postprocesador configurables; GPL, JPEG, TIFF y WebP instalados no produjeron artefacto headless verificable. Todos permanecen explícitamente ausentes del catálogo público.
- [x] `F08-T33` Rechazar parámetros/IDs arbitrarios de extensión; cada adapter publicado tiene schema, allowlist, threat model y fixture. — Los únicos adapters publicados son `inkscape-dxf/v1`, `inkscape-hpgl/v1`, `inkscape-fxg/v1` e `inkscape-sif/v1`: formatos y `fidelityPolicy` literales, sin IDs, parámetros ni argv de extensión aportados por cliente; tienen pruebas unitarias, smoke MCP y limitaciones documentadas.
- [x] `F08-T34` Implementar `document_optimize` como plan de operaciones seguras con dryRun, derivado por defecto y visual regression. — Sólo elimina defs top-level sin referencias; por defecto devuelve el plan, y al aplicar deriva `*.optimized.svg`, exige revisión, renderiza ambos SVG con Inkscape y rechaza publicar si existe diferencia visual.

#### Puerta F08

- [x] `F08-G01` Cada formato anunciado pasa export/import smoke real en la plataforma. — `npm run test:mcp` en Windows/Inkscape 1.4.4 publica y verifica PNG, PDF, SVG, SVG plano, PS, EPS, EMF, WMF experimental y los adapters DXF/HPGL/FXG/SIF. Reimporta los pares que tienen adaptador seguro (SVG/SVGZ, raster, PDF, EPS cuando la sonda lo valida y EMF); los tipos sin adaptador permanecen bloqueados y no se anuncian como importables.
- [ ] `F08-G02` Capabilities ausentes producen error recuperable y no cambian el catálogo MCP.
- [ ] `F08-G03` Los tres presets principales generan artefactos/manifests correctos.
- [x] `F08-G04` Package reabre sin referencias rotas dentro de entorno limpio. — `test:mcp` renderiza el SVG empaquetado por Inkscape con un PNG local copiado.
- [x] `F08-G05` Evidencia en `docs/progress/F08.md`.
- [~] `F08-G06` Preset execution rechaza planToken expirado, de otro workspace o ligado a sourceRevision/capabilities distintos. — El store comprueba TTL/owner/uso único y el batch vuelve a comprobar sourceRevision y fingerprint antes de renderizar; tests unitarios y MCP cubren owner y sourceRevision. Falta fixture que simule una huella de capabilities distinta.

---

### F09 — Integración MCP v2 completa

**Objetivo:** exponer el dominio de forma compatible, observable y fácil de usar por modelos.

Baseline: especificación MCP `2026-07-28`, SDK TypeScript v2 `@modelcontextprotocol/server`, Zod v4 y servidor stateless.

#### Servidor y stdio

- [x] `F09-T01` Consolidar/endurecer el `buildServer()` incremental como catálogo completo, determinista y sin estado implícito de documento activo. — Dos servidores stdio nuevos emiten el mismo catálogo de más de 80 tools, sin duplicados, y una inspección sin workspace falla de forma recuperable en lugar de seleccionar un documento implícito.
- [x] `F09-T02` Registrar instructions compactas: inspección, límites, overwrite, revisiones y capabilities. — La respuesta de inicialización declara instrucciones sobre workspace, rutas relativas, revisiones, overwrite y capabilities.
- [x] `F09-T03` Validar/endurecer el transporte stdio introducido en F01 con la API v2 oficial y todo el catálogo. — El smoke `test:f09-wp01` usa `StdioClientTransport` y negociación fijada a `2026-07-28` para listar el catálogo completo en procesos independientes.
- [x] `F09-T04` Repetir como regresión que stdout contiene únicamente framing MCP con el catálogo completo, errores y progreso activos. — La regresión conecta/lista/invoca dos veces sin interferencia de diagnósticos, inicia un cliente raw para parámetros MCP inválidos (respuesta JSON-RPC de error) y observa por `job_get` una exportación real con progreso monotónico `rendering`/`publishing`; los logs continúan exclusivamente por stderr. Las notificaciones push quedan como evolución de F09-T12/T13.
- [x] `F09-T05` Traducir errores de dominio a `isError` y protocolo mal formado a error MCP. — Una inspección fuera de workspace y un argumento extra estricto devuelven `isError` compatible, preservando la validación MCP del SDK para requests mal formados.
- [x] `F09-T06` Verificar tool annotations y output schemas. — `test:f09-wp01` exige que cada tool publique una anotación booleana válida y un output schema cerrado; cubre además las uniones tipadas de `document_export_batch` y las propiedades de contrato de tools representativas.

#### Resources y prompts

- [x] `F09-T07` Consolidar el registry opaco existente para document/artifact/job URIs con TTL/autorización uniforme. — Documentos, artefactos y manifests de jobs usan capabilities aleatorias sin rutas; los documentos revalidan revisión en cada lectura, los chunks siguen owner-bound y los manifests conservan owner internamente hasta expirar.
- [x] `F09-T08` Registrar capabilities, presets, metadata, summary, svg opt-in, artifacts y manifests. — Resources estáticos redaccionados publican capabilities y catálogos de presets; `document_inspect` emite links opacos de metadata/summary/SVG limitado y los jobs devuelven su manifest resource opaco.
- [x] `F09-T09` Implementar `resource_link`, template de chunks y `artifact_read_chunk` para artefactos grandes, con MIME, owner, hash, offset/length y `maxResourceReadBytes`; probar que stdio nunca carga/transmite el blob completo por accidente. — Los templates de artifact/document/export no se enumeran; `artifact_read_chunk` requiere owner y limita cada buffer a `maxResourceReadBytes`, devolviendo sólo hash, offset, longitud y chunk acotado.
- [x] `F09-T10` Implementar prompts audit/web/print/asset/optimize sin side effects ocultos. — Los cinco prompts son mensajes de receta explícitos con argumentos enum cerrados y no invocan tools ni filesystem.
- [x] `F09-T11` Probar URI enumeration, acceso cruzado y expiración. — Las pruebas unitarias cubren owner distinto, URI opaca, revisión stale, límite y TTL; el smoke stdio comprueba que documentos no se enumeran, los roots no se filtran, chunks de otro workspace fallan y los manifests expiran por capability.

#### Progreso, cancelación y jobs

- [x] `F09-T12` Leer progress token del contexto MCP. — El handler usa el token moderno de `mcpReq.envelope` y conserva el fallback legado `_meta`, sin aceptar un token como input público.
- [x] `F09-T13` Emitir progreso monotónico y rate-limited por etapas. — El batch síncrono notifica `validated`→`staging`→`rendering`→`verifying`→`publishing`→`completed`, con posiciones 1–6, total fijo, mensajes redaccionados y coalescing de 250 ms.
- [x] `F09-T14` Propagar `AbortSignal` a servicios y subprocesso. — La señal del request MCP llega al renderizador síncrono; el job owner-bound conserva su propia señal hasta Inkscape. La publicación atómica cierra la cancelación para no falsear un resultado ya publicado.
- [x] `F09-T15` Implementar jobs explícitos para lotes largos con TTL y ownership. — `JobStore` conserva owner, TTL terminal, progreso y callback terminal; los handlers purgan entradas terminales expiradas sin borrar un proceso activo.
- [x] `F09-T16` Implementar `job_get` y `job_cancel` idempotente. — Jobs owner-bound devuelven el mismo snapshot terminal ante cancelación repetida; el smoke MCP real cancela un PNG en curso, verifica que no publica output y repite la cancelación.
- [x] `F09-T17` Limpiar outputs parciales y no publicar recursos de jobs cancelados. — Los jobs exigen `all_or_nothing`; cancelar antes de publicar deja cero outputs, y cancelar un job elimina su capability de manifest. Una vez iniciada la publicación atómica el job termina como completado, no como un falso cancelado.

#### Compatibilidad y test MCP

- [x] `F09-T18` Pruebas del handler en proceso con cliente SDK fijado y negociación moderna exacta `2026-07-28`, aunque HTTP público llegue en F10. — El test in-process inicia únicamente un listener loopback efímero, negocia el handler con el cliente SDK fijado y comprueba era/version moderna antes de cerrarlo.
- [x] `F09-T19` InMemoryTransport con una versión legacy explícita soportada por la matriz; no inferir era por usar SDK v2 ni aceptar versiones desconocidas silenciosamente. — `InMemoryTransport` cubre el handshake legacy `2025-11-25` y afirma la era negociada; un intento pinned `2099-01-01` recibe el error tipado de versión no soportada.
- [x] `F09-T20` Stdio real con `StdioClientTransport`: casos moderno y legacy fijados, más rechazo/negociación correcta de una versión no soportada. — El smoke stdio compara dos catálogos modernos, enumera el catálogo legacy y exige el mismo conjunto de tools; la sonda pinned desconocida falla explícitamente.
- [x] `F09-T21` Probar structuredContent, texto compatible, images, resource links y errores. — Las pruebas comprueban texto/structuredContent equivalente, error recuperable, preview inline `image/png` y preview grande como `resource_link` opaco sin root.
- [x] `F09-T22` Probar catálogo y schemas por snapshot determinista. — La huella SHA-256 del catálogo ordenado (nombre, descripción, annotations, schemas de entrada/salida) se fija en prueba in-process y falla ante cualquier cambio contractual.
- [x] `F09-T23` Ejecutar Inspector oficial fijado en lockfile por stdio mediante `npm run inspect`; no descargar `latest` durante la prueba. — `test:f09-wp04` usa el launcher Inspector 2.3.0 ya fijado en `node_modules`, en modo CLI `tools/list`, sin red ni `latest`; exige el catálogo tipado esperado. `npm run inspect` conserva la apertura manual del Inspector.

#### Logging/telemetría

- [x] `F09-T24` Logger estructurado a stderr en stdio; prohibir `console.log` por lint/test. — `stdio-logging` emite eventos JSON redaccionados para arranque/error y ESLint rechaza `console` en source/test TypeScript; una prueba verifica que el logger no filtra token ni ruta Windows.
- [x] `F09-T25` No basar diseño nuevo en MCP logging, deprecado en la revisión 2026-07-28. — El diagnóstico sigue siendo stderr local y la telemetría es una clase interna sin tool, resource, notification ni llamada `logging/*` MCP.
- [x] `F09-T26` Añadir metrics/traces internas sin filtrar documentos/paths. — `InternalTelemetry` sólo acepta dos nombres allowlisted de ciclo stdio, conserva contador/duración/resultado y un máximo de 100 spans; no admite labels, payloads, exporters ni persistencia.

#### Puerta F09

- [x] `F09-G01` Cliente real puede completar todos los escenarios P0/P1 por stdio. — `npm run test:mcp` completo pasa con cliente moderno y legacy, import/export, recursos, jobs y rechazo seguro de entradas no compatibles.
- [x] `F09-G02` Inspector no encuentra schema/protocol errors. — `npm run test:f09-wp04` pasa con Inspector 2.3.0 fijado, contrato MCP y compatibilidad moderna/legacy.
- [x] `F09-G03` Cancelación y progreso funcionan en export batch real. — `npm run test:f09-wp03` y su smoke stdio comprueban progreso, cancelación y limpieza de manifest/output.
- [x] `F09-G04` Recursos no permiten enumerar/leer otro workspace/job. — `npm run test:f09-wp04` cubre owner ajeno, URI opaca, TTL, chunks y manifests de jobs.
- [x] `F09-G05` Snapshot del catálogo es estable con capability unavailable. — La huella determinista del catálogo y el contrato de capabilities pasan en `npm run test:f09-wp04`.
- [x] `F09-G06` Evidencia en `docs/progress/F09.md`. — Cierre registrado el 2026-08-30 con comandos y resultados reproducibles.

---

### F10 — Expansión opcional 1.x: HTTP, versiones y plataformas

**Objetivo:** ampliar transporte/plataforma sin debilitar la seguridad del servidor local. Esta fase P2 no bloquea el release Windows/stdio 1.0 de F11.

#### Streamable HTTP opt-in

- [x] `F10-T01` Implementar handler stateless con factoría de servidor por request usando API v2 oficial. — `createMcpHandler` v2 crea un servidor por request y rechaza el transporte legacy en HTTP.
- [x] `F10-T02` Escuchar `127.0.0.1`, endpoint `/mcp`, body/time/rate limits. — El listener sólo acepta `/mcp`, limita el cuerpo por `maxInputBytes`, usa el timeout de proceso y aplica 120 requests/minuto en loopback.
- [x] `F10-T03` Validar Host/Origin y probar DNS rebinding. — Las validaciones oficiales v2 preceden autenticación/dispatch y las pruebas cubren Host y Origin adversarios.
- [~] `F10-T04` Implementar bearer auth obligatorio siempre que HTTP esté activo, con redacción/rotación local; no ofrecer modo anónimo ni siquiera en loopback. — Token base64url ≥32 caracteres sólo por entorno, comparación constante y rotación por reinicio están implementados; falta una rotación sin reinicio y la revisión formal de threat model HTTP.
- [~] `F10-T05` Asociar documents/jobs/resources a autorización explícita, no a sesión MCP. — El runtime HTTP es compartido por proceso mientras cada request crea un servidor MCP nuevo; jobs, artefactos, planes y cachés sobreviven entre requests y mantienen su owner de workspace. Falta introducir principals/tokens múltiples y ligar ese owner a `authInfo` explícito en vez de al workspace.
- [~] `F10-T06` Añadir OpenTelemetry/logger HTTP estructurado. — Listener y rechazos HTTP emiten JSON estructurado/redactado a stderr, sin token, URL, body ni ruta documental; falta OpenTelemetry/metrics exportables y correlación por principal.
- [ ] `F10-T07` Ejecutar Inspector y conformance suite HTTP fijados en lockfile mediante scripts npm, con requirements/protocolo `2026-07-28` explícitos.

#### Inkscape 1.4 y 1.5+

- [ ] `F10-T08` Fijar y documentar soporte estable 1.4.4.
- [ ] `F10-T09` Revalidar/endurecer el adapter `pages_v14` de F03 frente a la matriz de versiones/plataformas.
- [ ] `F10-T10` Investigar/implementar `pages_v15` basado en `svg:view` solo contra release real.
- [ ] `F10-T11` Crear migración/round-trip fixtures 1.4.4 ↔ 1.5 sin pérdida silenciosa.
- [ ] `F10-T12` Gatear 1.5 como experimental hasta pasar toda matriz multipágina/exportación.
- [ ] `F10-T13` Mantener parsers de flags/actions por versión y warnings de drift.

#### Plataformas

- [ ] `F10-T14` CI/unit en Windows, Linux y macOS con Node soportado.
- [ ] `F10-T15` Integración real con Inkscape por plataforma/versiones declaradas.
- [ ] `F10-T16` Documentar formatos/extensiones variables por build.
- [ ] `F10-T17` En macOS 1.4.4, probar el problema conocido de extensiones lanzadas por CLI y deshabilitar capabilities afectadas.
- [ ] `F10-T18` Probar fuentes, paths Unicode, separadores, case y permisos.
- [ ] `F10-T19` No marcar plataforma como soportada solo porque compila.

#### Puerta F10

- [ ] `F10-G01` Conformance moderno HTTP pasa con seguridad local activa.
- [ ] `F10-G02` stdio sigue siendo default y no cambia su stdout.
- [ ] `F10-G03` Matriz publica versión/plataforma/formato con evidencia real.
- [ ] `F10-G04` 1.5 no se anuncia estable hasta superar fixtures multipágina.
- [ ] `F10-G05` Evidencia en `docs/progress/F10.md`.

---

### F11 — Hardening, documentación, empaquetado y release Windows 1.0

**Objetivo:** convertir el proyecto probado en paquete instalable y mantenible.

#### Hardening

- [x] `F11-T01` Ejecutar fuzz/property tests de units, paths, selectors, XML, path data y export schemas. — `tests/unit/hardening-property.test.ts` recorre entradas pseudoaleatorias deterministas y casos frontera para conversiones, paths de workspace/output, AST de path, selectores y referencias SVG externas.
- [x] `F11-T02` Ejecutar corpus adversarial de SVG/PDF/raster. — `tests/unit/adversarial-corpus.test.ts` cubre SVG activo/profundo/excesivo, PDF truncado y raster corrupto; los verificadores PNG exigen ahora IHDR/CRC/IEND completos y el inspector raster valida CRC de IHDR.
- [x] `F11-T03` Stress de archivos grandes, pages, objetos, DPI, lotes y concurrencia. — `tests/unit/stress-limits.test.ts` cubre 10.000 objetos SVG, 128 páginas, DPI 0.1/10.000, 50 variantes y 64 escritores contendiendo el mismo lock canónico.
- [x] `F11-T04` Crash/cancel/kill tests y escaneo de temporales/procesos huérfanos. — El runner prueba timeout, abort y árbol padre/nieto en Windows; `recoverStaleScratch` barre sólo temporales propios vencidos al arrancar. Los procesos desacoplados deliberadamente siguen siendo un riesgo residual documentado hasta contar con Job Object/helper nativo.
- [x] `F11-T05` Revisar dependencias, advisories, licencias y SBOM. — Auditoría npm sin vulnerabilidades, revisión de licencias runtime y generación local de SPDX 2.3 documentadas en `docs/dependency-audit.md`; el SBOM versionado de release se genera en F11-T22.
- [x] `F11-T06` Revisión manual del threat model y de todo uso de filesystem/process/XML. — `docs/security-surface-audit.md` registra la revisión y riesgos residuales; se corrigió `rewriteStagedAssetReferences` para sanitizar y rechazar SVG activo/remoto antes de parsearlo.
- [x] `F11-T07` Auditoría de logs para secretos/rutas/contenido. — `docs/logging-audit.md` registra el análisis; `redactDiagnostic` protege stderr de rutas/credenciales y una prueba fija esa redacción.

#### Documentación

- [x] `F11-T08` README: instalación de Inkscape, npm, doctor, config, stdio y ejemplos. — README actualizado con instalación Windows/MSIX, arranque stdio, configuración MCP, revisión esperada y catálogo agrupado de tools reales.
- [x] `F11-T09` Documentar MSIX versus instalación CLI-friendly y resolución de ruta. — `docs/windows-inkscape.md` explica discovery/redacción, diagnóstico, configuración de arranque y la prohibición de fijar directorios MSIX versionados o alterar `WindowsApps`.
- [x] `F11-T10` Documentar cada tool/schema/errores/ejemplos. — `docs/tool-reference.md` cubre las 81 tools, contratos, flujos, recuperación y `tools/list` como fuente canónica de schemas; una prueba falla si el catálogo y la referencia divergen.
- [x] `F11-T11` Guía de tamaños, viewBox, DPI, áreas y multipágina. — `docs/design-size-guide.md` distingue viewport físico de `viewBox`, documenta resize/fit, DPI y áreas PNG, IDs de páginas y los dos contratos PDF, con un flujo seguro verificable.
- [x] `F11-T12` Guía de export PNG/PDF/SVG y pérdida por formato. — `docs/export-guide.md` documenta verificaciones, áreas, DPI, filtros, texto, páginas, sidecars, presets y límites explícitos de PDF/X/CMYK.
- [x] `F11-T13` Guía de seguridad/workspace/overwrite/backups que distinga protección de estructura/rutas de contención de exploits nativos; documentar `securityLevel`, `nativeInputPolicy` y sandbox opcional sin afirmar aislamiento inexistente. — `doctor`/`inkscape_status` comparten la postura explícita y `docs/security-workspace-guide.md` documenta roots, revisiones, backups, recuperación y riesgos residuales.
- [x] `F11-T14` Matriz de compatibilidad versionada. — `docs/compatibility-matrix.md` fija la evidencia Windows/MSIX 1.4.4, transporte, import/export, flags gateados y exclusiones explícitas por formato/plataforma.
- [x] `F11-T15` Ejemplos de configuración para clientes MCP actuales, verificados al momento de release. — `docs/client-configuration.md` cubre Codex CLI 0.146.0 y VS Code 1.132.1 con plantilla stdio JSON validada y límites Windows explícitos.
- [x] `F11-T16` Troubleshooting de fuentes, GTK warnings, extensiones y outputs parciales. — `docs/troubleshooting-windows.md` aporta diagnóstico/recovery para discovery, workspaces, revisiones, fuentes, capabilities, recetas y publicación tras fallo.

#### Paquete y release

- [x] `F11-T17` Build ESM `dist/` y bin con shebang. — `npm run build` produce `dist/cli.js`; `test:pack` ejecuta el shim instalado.
- [x] `F11-T18` `package.json` bin `inkscape-mcp`, files allowlist y `mcpName` si corresponde. — `npm run pack:check` verifica la allowlist y `test:pack` confirma que npm crea y resuelve el shim `inkscape-mcp`.
- [x] `F11-T19` Instalar el `.tgz` producido en directorio temporal y ejecutar doctor/stdio real. — El smoke instala el tarball, parsea `--doctor --json` y conecta un cliente MCP al binario `dist` instalado.
- [x] `F11-T20` Probar instalación con npm limpio y sin source tree. — `scripts/pack-smoke.mjs` usa un prefijo temporal independiente, instala sólo el `.tgz` con npm y ejecuta el binario publicado, recetas y cola durable.
- [x] `F11-T21` Sincronizar versión package/server/changelog/server.json. — `0.1.0` alinea `package.json`, lockfile, CLI, server manifest y changelog; el test de metadata evita divergencias y el paquete permanece privado.
- [x] `F11-T22` Crear provenance/SBOM/checksums según infraestructura disponible. — `npm run release:provenance` crea localmente tarball, SPDX, provenance y `SHA256SUMS` de un árbol Git limpio, sin publicar artefactos.
- [ ] `F11-T23` Publicar npm solo con autorización explícita del usuario.
- [ ] `F11-T24` Preparar/publicar MCP Registry solo después de npm y con autorización explícita.
- [ ] `F11-T25` Tag/release/announcement solo con autorización explícita.
- [x] `F11-T26` CLI autónoma `export` sin IA: schema cerrado para SVG/preset/output, revisión automática, `--dry-run`, selección de workspace y salida JSON; reutiliza el MCP privado por stdio, sin bypass de políticas.
- [x] `F11-T27` Recetas declarativas `run`: JSON `inkscape-mcp-recipe/v1` cerrado para inspección, preflight y hasta 20 exports; se validan source, capabilities y colisiones antes de publicar, y devuelve un recibo JSON con códigos de salida estables.
- [x] `F11-T28` Automatización Windows sin IA: runner PowerShell no interactivo con log, rutas con espacios y propagación de exit code; script opt-in para tarea diaria del usuario actual con `-WhatIf`, sin GUI ni credenciales almacenadas.

#### Puerta 1.0 F11

- [ ] `F11-G01` Todas las puertas F00–F09 están cerradas; F10 puede constar como `[w]` diferido con alcance Windows/stdio explícito.
- [ ] `F11-G02` Suite P0/P1 e Inspector stdio pasan desde paquete instalado; conformance HTTP es obligatoria solo si F10 se incluye en ese release.
- [x] `F11-G03` Auditoría de seguridad no tiene hallazgos altos/críticos abiertos. — `npm audit` completo y runtime informaron cero vulnerabilidades; la revisión manual mantiene explícitos los riesgos nativos residuales.
- [x] `F11-G04` Documentación reproduce los escenarios de aceptación desde cero. — README y guías cubren instalación Windows, doctor, stdio, tests MCP/paquete, automatización y evidencia de release.
- [x] `F11-G05` La matriz no promete capabilities no probadas. — `docs/compatibility-matrix.md` separa baseline probado, gating y funciones no anunciadas/P2.
- [x] `F11-G06` Evidencia/notas de versión en `docs/progress/F11.md`. — WP20–WP21 registran metadata 0.1.0, artefactos reproducibles y gates ejecutados.
- [x] `F11-G07` `doctor`, status, README y SECURITY coinciden: 1.0 no anuncia procesamiento seguro de binarios/SVG de origen hostil sin sandbox nativo. — Todos declaran `workspace-guarded-native-unsandboxed` y `trusted-local-only`.

---

### F12 — Opcionales posteriores a 1.0

**Objetivo:** investigar capacidades que no deben retrasar ni desestabilizar el núcleo.

- [ ] `F12-T01` Benchmark de `inkscape --shell` con un worker aislado, reset, TTL, memory cap y recuperación.
- [ ] `F12-T02` Decidir por ADR si shell persistente mejora latencia sin reducir fiabilidad.
- [ ] `F12-T03` Diseñar extensión compañera para operaciones verdaderamente GUI-only.
- [ ] `F12-T04` Definir handshake/versionado entre extensión y MCP.
- [ ] `F12-T05` Mantener GUI bridge deshabilitado por defecto y con permisos separados.
- [ ] `F12-T06` Evaluar sandbox de SO/contenedor para documentos no confiables.
- [~] `F12-T07` Evaluar pipeline profesional CMYK/PDF-X/preprensa externo con especialista y fixtures. — `color_management_inspect` inventaría perfiles SVG locales, referencias `icc-color()`, candidatas CMYK de cuatro componentes y nombres sin declaración local; declara que no convierte CMYK ni valida output intents. Falta el pipeline externo, especialista y fixtures PDF/X.
- [ ] `F12-T08` Evaluar adapters de optimización/render externos sin sustituir Inkscape silenciosamente.
- [ ] `F12-T09` Diseñar plugin API interna allowlisted sin carga arbitraria desde el cliente.
- [ ] `F12-T10` Evaluar helper handle-based/ACL/sandbox nativo si se exige resistencia a un atacante local concurrente que altera reparse points.
- [ ] `F12-G01` Cada opcional tiene ADR, threat model, capability gate, tests y documentación antes de publicarse.

---

## 17. Estrategia de pruebas

### 17.1 Pirámide

#### Unitarias

- Schemas: casos válidos, límites, propiedades extra, discriminantes y mensajes.
- Conversión de unidades/rectángulos/matrices/redondeo.
- Builders de argv por formato y versión.
- Path resolver Windows/POSIX y pertenencia a roots.
- Sanitización XML/SVG y reescritura de IDs/refs.
- Resize planning y transform calculations.
- Parsers de salida/errores/capabilities.
- Locks, revisions, backup y commit.
- Naming de batch/manifests.

#### Fake process

El fake Inkscape debe poder configurarse para:

- devolver una versión/capabilities específicas;
- éxito con output válido;
- exit code no cero;
- exit 0 sin output;
- output parcial/corrupto;
- stdout/stderr enorme;
- timeout;
- ignorar señal inicial;
- lanzar hijo y nieto que ignoran terminación para validar el Job Object de Windows;
- crear archivos inesperados;
- escribir fuera de staging (debe detectarse/aislarse);
- modificar source/dependencia/destino entre snapshot y commit para provocar conflicto determinista;
- simular diferencias 1.4/1.5/plataforma.

#### Integración de dominio

- DOM round-trip y mutaciones sobre fixtures.
- Inkscape real con perfil aislado.
- Export validators.
- Import pipeline.
- Concurrencia y revisión.

#### Contrato MCP

- InMemoryTransport.
- Stdio real lanzando `dist/cli.js`.
- Handler HTTP en proceso.
- Structured content/text compatibility.
- Resources, resource links, prompts.
- Progreso/cancelación/jobs.
- Errores y annotations.
- Snapshot de catálogo/schemas.

#### E2E

- Cliente MCP → tool → filesystem/DOM/Inkscape → verificador → resource/artifact.
- Desde package `.tgz`, no solo source tree.
- Windows baseline obligatorio; otras plataformas según matriz declarada.

#### Visual regression

- Mantener `tests/fixtures/manifest.*` con engine/version/profile, tamaño, fondo, métrica y threshold por fixture.
- Renderizar source y resultado con la misma versión/perfil de Inkscape.
- Normalizar dimensiones/fondo/color mode.
- Comparar píxeles con tolerancia documentada y heatmap en fallo.
- No usar visual regression como sustituto de validación estructural.
- Aceptar diferencias solo mediante actualización revisada del golden + manifest + heatmap/razón; nunca aumentar un threshold global para hacer pasar la suite.

### 17.2 Corpus mínimo de fixtures

| Fixture                     | Casos que cubre                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `minimal.svg`               | root/namespaces/viewBox básico                                                                  |
| `physical-units.svg`        | mm/cm/in/pt/px y escala                                                                         |
| `no-viewbox.svg`            | normalización y warnings                                                                        |
| `percentage-size.svg`       | dimensiones relativas                                                                           |
| `negative-coordinates.svg`  | origin/bounds negativos                                                                         |
| `nested-transforms.svg`     | matrices anidadas                                                                               |
| `css-cascade.svg`           | specificity, `!important`, variables, `currentColor`, porcentajes y wrapper-sensitive selectors |
| `stroke-markers.svg`        | bounds visuales                                                                                 |
| `filters.svg`               | blur/shadow/rasterización                                                                       |
| `gradients-patterns.svg`    | defs/references                                                                                 |
| `clip-mask.svg`             | clips/masks                                                                                     |
| `text-fonts.svg`            | tspans, fuentes presente/faltante                                                               |
| `text-on-path.svg`          | referencias tipográficas                                                                        |
| `linked-images.svg`         | local/externo/roto                                                                              |
| `embedded-images.svg`       | data URI y límites                                                                              |
| `layers-groups.svg`         | namespaces/orden/locks                                                                          |
| `clones-symbols.svg`        | use/cycles/IDs                                                                                  |
| `paths-complex.svg`         | arcs, holes, self-intersection                                                                  |
| `multipage-1.4.svg`         | `inkscape:page` y export completo                                                               |
| `multipage-1.5.svg`         | `svg:view`, inicialmente gateado                                                                |
| `pdf-nonzero-viewbox.svg`   | regresión PDF con origen de `viewBox` no cero (problema 6323)                                   |
| `plain-svg-viewbox-512.svg` | regresión plain SVG de `viewBox`/dimensión 512 (problema 6317)                                  |
| `id-delimiters.svg`         | IDs con coma, punto y coma, espacios y Unicode; remapeo CLI/actions                             |
| `metadata.svg`              | RDF/license/title/desc                                                                          |
| `external-css.svg`          | estilos/recurso externo                                                                         |
| `malicious-xxe.svg`         | DTD/XXE                                                                                         |
| `malicious-script.svg`      | script/events/javascript/foreignObject                                                          |
| `duplicate-ids.svg`         | colisiones/refs ambiguas                                                                        |
| `large-but-valid.svg`       | límites y paginación                                                                            |
| `corrupt.svg`               | errores parseables                                                                              |

Los archivos binarios de fixture deben tener origen/licencia registrados y tamaño mínimo.

### 17.3 Matriz mínima de exportación

| Formato      | Área           | Tamaño     | Opciones clave     | Verificación           |
| ------------ | -------------- | ---------- | ------------------ | ---------------------- |
| PNG          | page           | 96/300 dpi | alpha/bg           | IHDR/dimensiones/píxel |
| PNG          | drawing        | width-only | ratio              | IHDR/bounds            |
| PNG          | selection      | exact px   | id-only            | visibilidad            |
| PNG          | custom         | rect/snap  | AA/color mode      | IHDR/visual            |
| PDF          | single         | physical   | 1.4/1.5            | header/boxes/pages     |
| PDF          | multipage all  | physical   | text/filter dpi    | pages/visual           |
| PDF          | selected pages | subset     | prune/merge        | pages/nombres          |
| SVG          | document       | source     | Inkscape metadata  | parse/reopen           |
| plain SVG    | document       | source     | text preserve/path | namespaces/visual      |
| SVG          | selection      | fit        | refs/defs          | autónomo/reopen        |
| PS/EPS       | drawing        | physical   | PS2/3/text/filter  | signature/visual       |
| EMF/WMF/XAML | temp crop      | capability | flatten policy     | round-trip/visual      |

### 17.4 Seguridad

Casos obligatorios:

- `../`, absolute, UNC, `C:relative`, mixed separators y encoded separators.
- NTFS ADS, trailing dot/space, reserved names y case variants.
- symlink/junction dentro→fuera y cambio antes de rename.
- metacarácteres `;&|$()`, el carácter backtick, comillas, newline y Unicode en nombres/labels.
- IDs con coma/punto y coma/colon/whitespace en `--query-id`, `--select`, `--export-id`, actions y salida `--query-all`; nunca dividir o seleccionar otro objeto por accidente.
- XML billion laughs, XXE, profundidad extrema y millones de atributos.
- script/event handlers/javascript URLs/external HTTP/file refs.
- SVG/PDF/raster enormes y decompression bombs.
- output ya existente, read-only, locked y revision conflict.
- cancelación durante parse, Inkscape, verify y commit.
- dos mutaciones/exportaciones concurrentes sobre el mismo destino y writer externo durante snapshot/commit.
- HTTP Host/Origin/auth/oversized body/replay/cross-workspace.

### 17.5 Rendimiento y límites iniciales

Valores predeterminados candidatos, sujetos a benchmark y configuración con topes separados:

- input SVG: 50 MiB;
- artefacto individual: 200 MiB;
- stdout de subprocesso: 8 MiB;
- stderr de subprocesso: 8 MiB;
- preview inline: 1 MiB;
- lectura de resource/chunk: 4 MiB;
- raster decodificado: 512 MiB;
- megapíxeles PNG: 100 MP;
- páginas: 100;
- operaciones por transacción: 100;
- elementos devueltos por página: 500;
- procesos concurrentes: 2 en desktop baseline;
- timeout simple: 60 s;
- timeout batch: derivado por variante con tope global.

El límite de raster decodificado se calcula con width × height × canales × bytes por canal más buffers de filtros/decoder; el límite de megapíxeles por sí solo no basta para 16-bit o múltiples buffers. Las pruebas deben medir inicio de Inkscape, export P50/P95, memoria, rendimiento y beneficio real de caché. No subir límites para “hacer pasar” fixtures adversariales.

### 17.6 Comandos de verificación previstos

Los nombres finales deben existir desde la fase indicada:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:e2e
npm run test:security
npm run test:visual
npm run build
npm run pack:check
node .\dist\cli.js --doctor --json
npm run inspect -- node .\dist\cli.js
npm run test:conformance -- --url http://127.0.0.1:3000/mcp --requirements 2026-07-28
```

Los scripts deben apuntar a devDependencies fijadas en `package-lock.json` (o usar `npx --no-install` internamente). No añadir `--force`, descargar `latest` ni silenciar fallos para cerrar una puerta.

---

## 18. Escenarios de aceptación de extremo a extremo

### 18.0 Trazabilidad

| Escenario | Fase/WP que lo cierra | Prioridad | Precondición/fixture                   |
| --------- | --------------------- | --------: | -------------------------------------- |
| A01       | F01-WP03–WP05         |        P0 | instalación 1.4.4 actual + fake runner |
| A02       | F03-WP02 + F05-WP02   |        P0 | `minimal-rect.svg`; no depende de F06  |
| A03–A04   | F03-WP03              |        P0 | fixtures resize numéricos              |
| A05       | F03-WP03 + F04-WP03   |        P0 | `negative-coordinates.svg`             |
| A06       | F03-WP04 + F05-WP03   |        P0 | `multipage-1.4.svg`                    |
| A07       | F05-WP04              |        P0 | `layers-groups.svg`                    |
| A08       | F05-WP05              |        P0 | icono fixture versionado               |
| A09       | F06-WP01–WP07         |        P1 | documento vacío creado en F03          |
| A10       | F07-WP01–WP03         |        P1 | `paths-complex.svg`, imagen fixture    |
| A11       | F04-WP02 + F07-WP04   |        P1 | `text-fonts.svg`                       |
| A12       | F08-WP01–WP02         |        P1 | PDF multipágina con licencia/origen    |
| A13       | F02-WP01 + F05-WP01   |        P0 | corpus de paths/metacarácteres         |
| A14       | F02-WP02 + F06-WP07   |     P0/P1 | dos clientes/revisiones                |
| A15       | F05-WP05 + F09-WP03   |        P1 | fake lento + batch real acotado        |

### A01 — Doctor sobre la instalación actual

**Dado** Inkscape 1.4.4 MSIX sin alias en PATH, **cuando** se ejecuta `doctor`, **entonces** localiza y valida `inkscape.exe` dentro del paquete o devuelve una instrucción exacta para configurar una distribución CLI-friendly; nunca inventa una ruta ni intenta eludir ACLs.

- [ ] Detecta versión/build.
- [ ] Reporta install kind MSIX.
- [ ] Reporta inputs, outputs base, flags y acciones.
- [ ] Redacta la ruta en la respuesta MCP.

### A02 — Crear A4 y exportar PNG para impresión

**Dado** `minimal-rect.svg` o un documento A4 fixture creado directamente por el helper de tests (sin depender de `elements_create` de F06), **cuando** se exporta page a 300 dpi, **entonces** el PNG mide 2480 × 3508 px bajo la política documentada.

- [ ] SVG maestro sigue editable.
- [ ] Tamaño físico es 210 × 297 mm.
- [ ] Manifest incluye revision/version/hash/dimensiones.
- [ ] Transparencia/fondo concuerdan con request.

### A03 — Cambiar lienzo sin mover diseño

**Dado** un diseño 800 × 600 px, **cuando** se cambia página a 1080 × 1080 con `page_only`, **entonces** atributos/transforms/bounds de elementos no cambian.

- [ ] Dry run anticipa áreas fuera de página.
- [ ] Mutación devuelve diff solo de documento/página.
- [ ] Backup/revision funcionan.

### A04 — Escalar contenido con contain/cover

**Dado** diseño apaisado, **cuando** se adapta a cuadrado, **entonces** contain conserva todo y cover llena el formato con recorte advertido.

- [ ] Anchor center y corner pasan fixtures.
- [ ] No hay stretch sin permiso.
- [ ] Preview permite comparar ambos modos.

### A05 — Fit a dibujo con margen físico

**Dado** contenido con coordenadas negativas y stroke, **cuando** se hace fit visual con margen 3 mm, **entonces** cada lado respeta la tolerancia numérica fijada para `negative-coordinates.svg` en el manifest.

- [ ] Declara bounds visuales.
- [ ] No transforma contenido.
- [ ] ViewBox/tamaño físico quedan coherentes.

### A06 — PDF multipágina

**Dado** SVG 1.4.4 con tres páginas de tamaños distintos, **cuando** se exporta `all` a un PDF, **entonces** existe un solo PDF con tres páginas y boxes correctas.

- [ ] El flujo completo omite `--export-page` en 1.4.4; la sonda protege frente a drift de versión/build.
- [ ] Subset 1+3 usa poda temporal en 1.4.4 y declara `prune`; direct/merge requieren capability/ADR explícitos.
- [ ] Páginas separadas usan nombres deterministas `_pN` o convención documentada.

### A07 — SVG de intercambio

**Dado** SVG Inkscape con capas/guías/metadata, **cuando** se exporta plain SVG, **entonces** el maestro no cambia y el derivado abre/renderiza correctamente, con reporte de metadata/editabilidad perdida.

- [ ] No sobrescribe el maestro.
- [ ] Refs/IDs siguen válidos.
- [ ] Pasa visual regression.

### A08 — Icon pack atómico

**Dado** un icono vectorial, **cuando** se solicita pack 16–512 px all-or-nothing, **entonces** se publica un directorio mediante rename único o un manifest commit marker que referencia todos los PNG válidos; sin marker/directorio final el lote no cuenta como publicado.

- [ ] Nombres y tamaños exactos.
- [ ] Cancelación limpia staging.
- [ ] Colisión sin overwrite falla antes de publicar.
- [ ] Crash injection demuestra la garantía y el riesgo residual declarados por la estrategia elegida.

### A09 — Diseño completo por transacción

**Dado** documento vacío, **cuando** una transacción crea layers, fondo, gradiente, shapes, path, texto e imagen y alinea objetos, **entonces** todos los IDs/refs/bounds son consultables y el diseño reabre.

- [ ] Un alias interno enlaza gradiente/text path creados en la misma llamada.
- [ ] Un fallo intermedio revierte todo.
- [ ] Diff resume objetos creados/cambiados.

### A10 — Paths y clipping

**Dado** dos paths y una imagen, **cuando** se aplica union/difference y crop por clip, **entonces** el orden de operands y los IDs resultantes son deterministas.

- [ ] Geometría/visual pasan fixtures.
- [ ] Snapshot permite restaurar.
- [ ] Export PNG/PDF conserva resultado.

### A11 — Fuentes faltantes

**Dado** un SVG con fuente ausente, **cuando** se inspecciona/exporta PDF, **entonces** preflight alerta antes y el manifest declara estrategia de texto.

- [ ] No afirma que la fuente se incrustó sin verificar.
- [ ] Text-to-path solo ocurre si fue solicitado.
- [ ] El diseño maestro no pierde texto editable.

### A12 — Importación PDF

**Dado** PDF de varias páginas, **cuando** se importan páginas 1 y 3, **entonces** el pipeline produce SVG temporal inspeccionado y documenta importador/estrategia/pérdidas.

- [ ] Modos interno y Poppler son diferenciables.
- [ ] Página cifrada/corrupta falla limpiamente.
- [ ] No se incorpora output parcial al maestro.

### A13 — Defensa de paths/comandos

**Dado** output `..\fuera.png` o nombre con metacarácteres, **cuando** se exporta, **entonces** traversal es rechazado y un nombre permitido se pasa como un único argumento sin shell.

- [ ] Ningún archivo fuera del root cambia.
- [ ] Logs no filtran path externo.
- [ ] No se ejecuta comando adicional.

### A14 — Concurrencia/revisión

**Dado** dos clientes con la misma revisión, **cuando** ambos mutan, **entonces** uno hace commit y el segundo recibe `REVISION_CONFLICT` sin perder cambios.

- [ ] Locks se liberan en fallo/cancelación.
- [ ] No hay archivo truncado.
- [ ] El cliente puede reinspeccionar y reintentar.
- [ ] Dos exports con el mismo `expectedOutputRevision` al mismo destino producen un commit y un `OUTPUT_REVISION_CONFLICT`.

### A15 — Cancelación de batch

**Dado** un lote largo, **cuando** el cliente cancela, **entonces** progreso se detiene, Inkscape termina, temporales se limpian y el job queda `cancelled`.

- [ ] No hay procesos huérfanos.
- [ ] No hay resource links a parciales.
- [ ] Cancelar de nuevo es idempotente.

---

## 19. Registro de riesgos

| ID  | Riesgo                                                                      |       Sev. | Mitigación / prueba                                                                                   |        Fase |
| --- | --------------------------------------------------------------------------- | ---------: | ----------------------------------------------------------------------------------------------------- | ----------: |
| R01 | MSIX sin alias o CLI capturable de forma estable                            |       Alta | discovery real, validar candidato, ruta explícita/distribución alternativa                            |         F01 |
| R02 | Drift multipágina 1.4→1.5 (`inkscape:page`→`svg:view`)                      |       Alta | pin 1.4.4, adapters separados, fixtures migración                                                     |     F03/F10 |
| R03 | 1075 acciones incluyen GUI/extensiones/no fiables                           |       Alta | registry allowlisted + smoke por acción/version                                                       |     F01/F07 |
| R04 | Exportación con pérdida visual/semántica                                    |       Alta | maestro SVG inmutable, preflight, visual regression, manifest                                         |     F05/F08 |
| R05 | Sobrescritura/vacuum/conversión irreversible                                |       Alta | overwrite false, snapshot, expectedRevision, copy-on-write                                            |        F02+ |
| R06 | Inyección por actions/CLI/shell                                             |       Alta | argv array, unions tipadas, sin raw escape público                                                    |     F01/F07 |
| R07 | Traversal/symlink/UNC/TOCTOU                                                |       Alta | roots/recheck/tests + ACL assumption; riesgo local concurrente declarado                              |     F02/F12 |
| R08 | Bombas de memoria SVG/PDF/PNG                                               |       Alta | límites separados de input, streams, artefacto, chunk, raster decodificado, MP, tiempo y concurrencia |     F02/F05 |
| R09 | Fuentes ausentes/sustituidas                                                |       Alta | preflight, profile reproducible, text strategy manifest                                               |     F04/F07 |
| R10 | Recursos externos/SSRF/data exfiltration                                    |       Alta | red deny, local roots, sanitize/redact refs                                                           |     F02/F07 |
| R11 | Extensiones/dependencias variables                                          |       Alta | capabilities por instalación, adaptadores opt-in                                                      |     F01/F08 |
| R12 | Extensiones CLI rotas en macOS 1.4.4                                        |       Alta | platform smoke, deshabilitar capability/alternativa                                                   |         F10 |
| R13 | El man sugiere multipágina pero código 1.4.4 separa `--export-page` a `_pN` |       Alta | sonda real; prune para subset único; page validation                                                  |         F05 |
| R14 | Perfil compartido cambia preferencias/resultados                            |       Alta | `INKSCAPE_PROFILE_DIR` aislado por worker                                                             |         F01 |
| R15 | Acción requiere GUI/active window                                           | Media-alta | excluir núcleo; capability no-headless; F12 bridge                                                    |     F07/F12 |
| R16 | Exit 0 sin output válido                                                    |       Alta | verificador de firma/estructura/metadata/hash                                                         |         F05 |
| R17 | Confusión página/dibujo/viewBox/unidades                                    |       Alta | tipos distintos, explicit modes, fixtures físicos                                                     |         F03 |
| R18 | Width+height PNG deforma                                                    | Media-alta | preserve ratio default; opt-in distortion                                                             |         F05 |
| R19 | Margin difiere por formato y `--export-margin` no es fiable en 1.4.4        |       Alta | sonda de boxes; temporal/area/page expansion; tests                                                   |         F05 |
| R20 | Parser XML rompe namespaces/refs                                            |       Alta | spike/corpus/round-trip/visual regression                                                             |         F02 |
| R21 | Locks/rename difieren en Windows                                            |       Alta | tests reales, retry acotado, crash consistency                                                        |         F02 |
| R22 | SDK/spec MCP cambian                                                        | Media-alta | pin v2/spec era, contract/conformance, changelog review                                               |     F09/F11 |
| R23 | HTTP permite DNS rebinding/acceso cruzado                                   |       Alta | loopback, Host/Origin/auth/ownership tests                                                            |         F10 |
| R24 | Dependencia nativa no soporta Node/plataforma                               | Media-alta | spike y preferencia JS pura; CI/package smoke                                                         |     F00/F11 |
| R25 | Licencia de fuentes/assets/dependencias                                     |       Alta | inventario/licencia; no package automático                                                            |     F00/F08 |
| R26 | Tool catalog demasiado grande/confuso                                       |      Media | ~30 semánticas, agrupación por dominio, transacción tipada y prompts                                  |         F09 |
| R27 | Resultados gigantes saturan contexto/stdio                                  | Media-alta | resúmenes, paginación, resource links, chunks e inline cap                                            |     F04/F09 |
| R28 | Caché devuelve preview/capabilities obsoletos                               |      Media | revisión + huella de ejecutable/perfil/data dirs/INX/helpers, TTL/invalidation                        |     F01/F04 |
| R29 | Plain/optimized SVG elimina semántica necesaria                             |       Alta | siempre derivado, reporte de pérdidas, reopen/visual                                                  |     F05/F08 |
| R30 | CMYK/PDF-X se promete sin cadena real                                       |       Alta | warning/no garantía; adaptador externo solo F12                                                       |     F04/F12 |
| R31 | Crash durante publicación multilarchivo deja subset físico                  |       Alta | directory rename o manifest commit; staging recovery; no prometer transacción                         |         F05 |
| R32 | Exploit desconocido en parser nativo                                        |    Crítica | trusted-local-only en 1.0, limitación visible; sandbox reforzado opcional F12                         | F02/F11/F12 |
| R33 | Source/dependencia cambia durante invocación                                |       Alta | NativeInputBundle inmutable, hashes y recheck antes de commit                                         |     F02/F05 |
| R34 | Cancelación mata solo al padre en Windows                                   |       Alta | Job Object/equivalente desde launch y tests de nietos resistentes                                     |         F01 |
| R35 | Escalado cambia cascada CSS/refs                                            |       Alta | subconjunto/ADR, fidelity, fixtures difíciles, rechazo por default                                    |     F03/F06 |
| R36 | Separadores dentro de IDs alteran query/select/export                       |       Alta | remapeo reversible en actions y todos los flags/listas CLI; corpus adversarial                        | F01/F06/F07 |
| R37 | Regresiones de `viewBox` en PDF/plain SVG                                   |       Alta | fixtures 6323/6317, sonda por build, workaround solo si se reproduce                                  |         F05 |

Todo riesgo nuevo de severidad alta se añade a esta tabla antes de cerrar la fase donde se descubre.

---

## 20. Decisiones abiertas que requieren resolución explícita

Estados: `open`, `proposed`, `resolved` o `waived`. Toda resolución enlaza ADR/progress/test; cambiarla después exige nueva decisión compatible o versión mayor.

| ID   | Decisión                               | Estado inicial | Responsable                   |           Plazo | Propuesta / evidencia esperada                                            |
| ---- | -------------------------------------- | -------------- | ----------------------------- | --------------: | ------------------------------------------------------------------------- |
| D001 | Nombre npm/MCP                         | resolved       | usuario                       |         F00-T01 | `inkscape-mcp`; repositorio público `Berrio/inkscape-mcp`                 |
| D002 | Licencia                               | resolved       | usuario                       |         F00-T01 | MIT; archivo `LICENSE`                                                    |
| D003 | Node/SDK/Zod/version policy            | resolved       | implementer + review          |        F00-WP02 | Node 24, TypeScript 6, SDK v2 y Zod 4 fijados; ADR-001/lock/tests         |
| D004 | Parser DOM/XML                         | open           | implementer + review          |         F02-T16 | elegir por corpus/fidelidad/seguridad/licencia; ADR                       |
| D005 | Threat model TOCTOU/ACL                | proposed       | implementer + user            |         F02-T00 | cliente hostil, no atacante local concurrente; ADR                        |
| D006 | Atomicidad batch                       | proposed       | implementer + review          |        F05-WP01 | directory rename o manifest commit; crash tests                           |
| D007 | Semántica page/viewBox/coordinates     | proposed       | implementer + review          |         F03-T00 | políticas/vectores de §10; ADR                                            |
| D008 | IDs de páginas sintéticos/persistentes | proposed       | implementer + review          |         F03-T00 | mapping ligado a revisión; fixtures                                       |
| D009 | Librería path/geometry                 | open           | implementer + review          |         F06-T10 | JS pura + Inkscape autoritativo para visual bounds                        |
| D010 | Inspector PDF                          | resolved       | implementer + review          |         F05-T14 | `pdf-lib` 1.17.1 MIT; ADR-011, page count/MediaBox/CropBox/hash           |
| D011 | Subset PDF único                       | resolved       | implementer + review          |         F05-T14 | poda SVG en 1.4.4; direct futuro por sonda; merge último recurso; ADR-011 |
| D012 | Artifact/job/resource ownership y TTL  | open           | implementer + security review | F02-T22/F09-T07 | IDs opacos ligados a auth/workspace; tests cruzados                       |
| D013 | Overwrite concurrente de outputs       | proposed       | implementer + security review |         F02-T09 | lock + expectedOutputRevision; race tests                                 |
| D014 | Instalación Inkscape adicional         | proposed       | usuario                       |         F01-G01 | solo si MSIX falla desde Node runner                                      |
| D015 | Alcance P1/P2 de Windows 1.0           | proposed       | usuario + maintainer          |    antes de F07 | tabla §16; optional marcado `[w]`                                         |
| D016 | Compatibilidad Inkscape 1.5            | proposed       | maintainer                    |             F10 | experimental hasta matriz completa                                        |
| D017 | HTTP                                   | proposed       | usuario + security review     |             F10 | opt-in, loopback, Host/Origin/auth                                        |
| D018 | Publicación npm/Registry               | open           | usuario                       |             F11 | autorización separada y evidencia de package smoke                        |
| D019 | Confianza de inputs nativos            | proposed       | usuario + security review     |         F02-T00 | 1.0 `trusted-local-only`; `securityLevel` visible; sandbox fuera del core |
| D020 | Motor/subconjunto CSS y escalado       | open           | implementer + review          |         F03-T00 | ADR, fidelity y fixtures de cascada/wrappers                              |
| D021 | Contratos de export por formato        | proposed       | implementer + review          |         F05-T01 | unión de §11, áreas/opciones inválidas rechazadas por schema/tests        |
| D022 | Lectura de artefactos grandes          | proposed       | implementer + security review | F02-T23/F09-T09 | resource chunks/offsets acotados y streaming HTTP autenticado             |
| D023 | Snapshot de inputs nativos             | proposed       | implementer + security review |         F02-T24 | bundle inmutable + manifest/hash/recheck; prueba de writer externo        |

El modelo ejecutor no decide solo sobre licencia, publicación o ampliación de acceso.

---

## 21. Orden crítico y puntos de parada útiles

| Corte               | Fases                      | Resultado utilizable                                  |
| ------------------- | -------------------------- | ----------------------------------------------------- |
| Bootstrap           | F00–F02                    | proyecto seguro, doctor/runner/workspace/DOM          |
| MVP tamaños/export  | F03–F05                    | crear/redimensionar/inspeccionar/exportar PNG/PDF/SVG |
| Diseño 1.0          | F06–F09                    | edición amplia + MCP completo stdio                   |
| Release Windows 1.0 | F11 después de F09         | paquete stdio 1.0 con baseline Inkscape 1.4.4         |
| Expansión 1.x       | F10 antes o después de F11 | HTTP opcional, Inkscape 1.5 y matriz cross-platform   |
| Investigación       | F12                        | optimizaciones/GUI/preprensa opcionales               |

El primer punto recomendado para probar con usuarios es después de F05. No esperar a implementar todas las operaciones avanzadas para validar contratos de tamaños/exportación.

---

## 22. Checklist de revisión de cada PR/diff

- [ ] El cambio pertenece a la fase activa.
- [ ] No modifica trabajo ajeno o no relacionado.
- [ ] El contrato/schema está documentado antes o junto al handler.
- [ ] Input estricto y límites definidos.
- [ ] No acepta raw command/action/path absoluto.
- [ ] Paths pasan por el resolver canónico.
- [ ] Procesos pasan por el runner único.
- [ ] Mutaciones usan lock, expectedRevision, staging, validación y commit.
- [ ] Overwrite/destructive annotations son honestos.
- [ ] Resultado tiene outputSchema, texto compatible y structuredContent.
- [ ] Warnings/errores tienen códigos estables y remediation.
- [ ] Cancelación/timeout/cleanup están cubiertos si hay IO/proceso.
- [ ] Tests positivos, negativos, límites y plataforma relevante.
- [ ] Fixture nuevo tiene licencia/origen y tamaño razonable.
- [ ] Logs no contaminan stdout ni filtran datos.
- [ ] README/docs/progress/checklist están actualizados.
- [ ] `npm run check` pasa.
- [ ] No se marcaron capacidades sin prueba real.

---

## 23. Checklist final de alcance de diseño

Antes de declarar “hace todo lo posible”, revisar explícitamente:

- [ ] Documento y metadata.
- [ ] Página, tamaño, unidades, viewBox y orientación.
- [ ] Multipágina.
- [ ] Shapes.
- [ ] Paths y booleanas.
- [ ] Transformaciones.
- [ ] Alineación/distribución/orden Z.
- [ ] Layers/groups.
- [ ] Fill/stroke.
- [ ] Gradients/patterns/markers.
- [ ] Clips/masks.
- [ ] Filtros seleccionados.
- [ ] Texto y tipografía.
- [ ] Texto en path/flow/conversión.
- [ ] Imágenes linked/embedded/crop/trace gateado.
- [ ] Símbolos/clones.
- [ ] Guías/grids.
- [ ] Colores/preflight.
- [ ] Accesibilidad/metadata.
- [ ] Importaciones declaradas.
- [ ] PNG.
- [ ] PDF single/multipage/subset.
- [ ] SVG Inkscape/plain/optimized gateado.
- [ ] PS/EPS/EMF/WMF/XAML gateados.
- [ ] Preview, batch, presets y manifests.
- [ ] Snapshots/revisions/restore.
- [ ] Capability degradation y limitaciones documentadas.

---

## 24. Referencias técnicas primarias

### Inkscape

- [Inkscape 1.4.4 — descarga oficial](https://inkscape.org/release/inkscape-1.4.4)
- [Anuncio oficial de Inkscape 1.4.4 (6 de mayo de 2026)](https://lists.inkscape.org/hyperkitty/list/inkscape-docs%40lists.inkscape.org/thread/OCEYDBJCKK2ZF65O3FNKZOSTL7JBTZND/)
- [Notas oficiales de Inkscape 1.4.4](https://inkscape.org/doc/release_notes/1.4.4/Inkscape_1.4.4.html)
- [Man page 1.4.4 fijada al tag](https://gitlab.com/inkscape/inkscape/-/blob/INKSCAPE_1_4_4/man/inkscape.pod.in)
- [Registro de opciones CLI 1.4.4](https://gitlab.com/inkscape/inkscape/-/blob/INKSCAPE_1_4_4/src/inkscape-application.cpp#L718)
- [Implementación de exportación 1.4.4](https://gitlab.com/inkscape/inkscape/-/blob/INKSCAPE_1_4_4/src/io/file-export-cmd.cpp)
- [Problema 6323 — PDF y origen no cero de viewBox](https://gitlab.com/inkscape/inkscape/-/work_items/6323)
- [Problema 6317 — plain SVG y viewBox 512](https://gitlab.com/inkscape/inkscape/-/work_items/6317)
- [Uso oficial de la línea de comandos](https://wiki.inkscape.org/wiki/Using_the_Command_Line)
- [Árbol de acciones 1.4.4](https://gitlab.com/inkscape/inkscape/-/tree/INKSCAPE_1_4_4/src/actions)
- [Unidades en Inkscape](https://wiki.inkscape.org/wiki/Units_In_Inkscape)
- [Multipágina](https://wiki.inkscape.org/wiki/Multipage)
- [Manual de exportación PDF](https://inkscape-manuals.readthedocs.io/en/latest/export-pdf.html)
- [Manual de otros formatos de exportación](https://inkscape-manuals.readthedocs.io/en/latest/export-other-formats.html)
- [Manual de otros formatos de importación](https://inkscape-manuals.readthedocs.io/en/latest/import-other-formats.html)
- [Documentación de extensiones INX](https://inkscape.gitlab.io/extensions/documentation/authors/inx-overview.html)
- [Exportador XAML oficial](https://inkscape.gitlab.io/extensions/documentation/extensions/svg2xaml.html)
- [SVG 2 — W3C](https://www.w3.org/TR/SVG2/)

Nota: la URL histórica de unidades contiene el título `Units_In_Inkscape`; verificar el enlace durante F00 si la wiki cambia.

### MCP y Node.js

- [Especificación MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Transportes MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Tools MCP](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Resources MCP](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)
- [Prompts MCP](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts)
- [Progreso MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress)
- [Cancelación MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation)
- [SDK TypeScript v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Servidor stdio del SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)
- [Servidor HTTP del SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)
- [Testing del SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md)
- [Inspector MCP](https://github.com/modelcontextprotocol/inspector)
- [Conformance MCP](https://github.com/modelcontextprotocol/conformance)
- [Node.js filesystem](https://nodejs.org/api/fs.html)
- [Node.js child_process](https://nodejs.org/api/child_process.html)

### Selección del modelo ejecutor

- [Guía oficial de modelos GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model)
- [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

---

## 25. Estado maestro

### Planificación

- [x] Auditoría de carpeta.
- [x] Auditoría de toolchain local.
- [x] Detección y sonda de Inkscape 1.4.4 MSIX.
- [x] Revisión de capacidades oficiales de Inkscape 1.4.4.
- [x] Revisión del SDK/especificación MCP actuales.
- [x] Arquitectura y modelo de seguridad definidos.
- [x] Catálogo objetivo definido.
- [x] Fases/checklists/puertas definidas.
- [x] Estrategia de pruebas y aceptación definida.
- [x] Modelo ejecutor recomendado.

### Implementación

- [x] F00 Bootstrap.
- [~] F01 Discovery/runner (todos los WP implementados; gates de acciones, carreras y Job Object aún abiertos).
- [~] F02 Workspace/XML/transacciones.
- [~] F03 Tamaños/páginas.
- [x] F04 Inspección/preflight/preview.
- [x] F05 Exportación MVP.
- [x] F06 Diseño básico.
- [~] F07 Diseño avanzado.
- [~] F08 Importación/formatos/presets.
- [~] F09 MCP completo.
- [~] F11 Release Windows/stdio 1.0: CLI autónoma, recetas y automatización Windows terminadas; faltan sus gates de release.
- [~] F10 Expansión HTTP/versiones/plataformas (P2; no bloquea 1.0).
- [~] F12 Opcionales.

### Continuidad sin tokens

- [x] Exportación local por CLI, receta declarativa y runner Windows sin IA.
- [x] Cola durable local: `queue enqueue/work/list/get/cancel/retry` persiste
      recetas y recibos, recupera worker interrumpido como fallo explícito,
      permite reintento y registra cancelación cooperativa tras el batch
      atómico en curso.
- [x] Evidencia local reproducible del paquete Windows/stdio: `check`, MCP por
      stdio, automatización PowerShell, paquete aislado y candidate con SBOM,
      provenance y checksums. No publica npm ni un registry.

#### Cola priorizada para un modelo menor

Regla de ejecución: tomar **una** tarjeta, conservar el scope, ejecutar sus
tests antes de hacer commit/push y continuar con la siguiente. No deshacer
cambios ajenos, no publicar paquetes ni activar HTTP/GUI sin autorización.

1. **P0 - Mantener operable el flujo sin IA.** Ante un cambio de dependencia,
   Inkscape o Windows, ejecutar `npm run check`, `npm run test:mcp`,
   `npm run test:windows` y `npm run test:pack`; regenerar una carpeta
   candidata de `release:provenance` con nombre nuevo. Corregir primero
   cualquier regresión de CLI, receta, cola, PowerShell o paquete instalado.
2. **P0 - Cerrar seguridad y concurrencia que afectan el uso local.** Completar
   gates pendientes F01/F02: acciones nativas permitidas con mapeo de IDs,
   carreras de outputs/revisiones y el aislamiento de procesos Windows que
   falta. Cada caso debe tener fixture de fallo y no ampliar workspaces.
3. **P1 - Completar importación segura y visible.** Mantener SVG/SVGZ,
   raster y PDF como adaptadores separados mientras no haya una transacción
   común probada. Añadir primero manifests comparables y preflight de
   fuentes/perfiles; los formatos AI/EPS/PS/EMF/WMF/XAML/DXF permanecen
   `detected-but-blocked` hasta un fixture real headless por formato.
4. **P1 - Terminar los recursos MCP de documentos grandes.** Priorizar F09:
   registry opaco con TTL/owner, `resource_link` y lectura por chunks para que
   stdio no devuelva blobs o SVG grandes al contexto. Probar aislamiento entre
   workspaces antes de anunciar cada resource.
5. **P1 - Diseño avanzado con fidelidad comprobable.** Cerrar solo las
   operaciones F07 que tienen contrato mecánico: orden/selección y remapeo de
   IDs, corpus visual de booleanas y transforms, y bitmap trace únicamente
   tras medir costo y resultado. No prometer LPE paramétrico o mesh editable
   sin fixtures nativos.
6. **P1 - Presets y empaquetado práctico.** Completar los presets de canal y
   empaquetado de assets con manifests, colisiones y verificación visual. No
   agregar formatos de exportación secundarios sin sonda y round-trip.
7. **P2 - HTTP y matriz de plataformas.** Solo después del release stdio:
   principals/ownership HTTP, rotación sin reinicio, logging/telemetría y
   conformance HTTP. Luego validar Inkscape 1.5, macOS y Linux de forma
   independiente; nunca heredar la etiqueta Windows probado.
8. **P3 - Investigación aislada.** GUI bridge, sandbox nativo, CMYK/PDF-X,
   extensiones/optimizadores y formatos profesionales requieren ADR, experto o
   adapter externo, capability gate, fixtures y documentación antes de entrar
   al catálogo público.

**Siguiente acción recomendada:** `gpt-5.6-luna` con razonamiento `high` puede
tomar las tarjetas mecánicas de P0/P1 (tests, manifests, resources y docs).
Usar `gpt-5.6-terra` con `high` para cambios de seguridad, concurrencia,
geometría, contratos MCP o cualquier decisión de alcance. Empezar por la
primera tarjeta no cerrada, no por una fase ya completada.
