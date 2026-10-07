# Auditoría de código — inkscape-mcp

- **Fecha:** 2026-10-07
- **Commit auditado:** `5cc6498` (rama `main`, árbol limpio)
- **Alcance:** `src/` (seguridad, robustez y cumplimiento de las invariantes de `AGENTS.md`), dependencias de producción, scripts de automatización de Windows y **validación funcional completa** (suite unitaria y puertas end-to-end con Inkscape real).
- **Entorno:** Windows 11 Pro 10.0.26200, Node 24.18.0, Inkscape 1.4.4 MSIX (`1.4.4 (dcaf3e7, 2026-05-05)`).
- **Tipo:** revisión estática, ejecución de todas las suites/puertas del repo y pruebas de concepto contra el servidor MCP real.

## 1. Resumen ejecutivo

**Funcionamiento:** el proyecto funciona. `npm run check` (format, lint, typecheck, build y 319 tests) pasa, y las **32 puertas funcionales** pasan cuando se ejecutan en condiciones normales. Entre ellas están la CLI autónoma, la automatización de Windows, el MCP stdio moderno y legacy, las exportaciones PNG/PDF/SVG, el multipágina, la recuperación de lotes, la cancelación, los presets, los recursos/prompts, el baseline 1.4.4 y el smoke del paquete. El único fallo observado (`test:mcp`) fue intermitente: ocurrió bajo carga concurrente y no se reprodujo en aislamiento (ver M-09).

**Seguridad:** las fronteras críticas están bien construidas:

- el resolver de rutas usa `realpath` y verifica la contención;
- todos los procesos pasan por un único runner con `shell: false`;
- el commit es atómico y exige revisión;
- el staging nativo es inmutable;
- HTTP solo escucha en loopback y exige bearer.

Aun así hay **un hallazgo crítico confirmado end-to-end con Inkscape real**: un SVG del workspace puede hacer que Inkscape incruste en el PNG exportado una imagen situada **fuera** del workspace. Basta con usar un prefijo XLink alternativo (`xl:href`) o el atributo `sodipodi:absref`. Además se confirmó de punta a punta que los errores de Node con **rutas absolutas** llegan tal cual al cliente MCP.

| Severidad | Cantidad |
| --------- | -------- |
| Crítica   | 1        |
| Alta      | 1        |
| Media     | 10       |
| Baja      | 7        |
| Info      | 5        |

> Corrección respecto a la primera versión de este informe: el antiguo **A-03** ("propiedades desconocidas se descartan en silencio") era un **falso positivo**. `server/index.ts` redefine `z.object` como `z.strictObject`, así que las claves desconocidas se rechazan (verificado en `workspace_list_documents` y `export_png`). Ahora figura como informativo (I-05).
>
> **Estado:** todos los hallazgos accionables se corrigieron el mismo día; ver §7.

## 2. Validación funcional

### 2.1 Suite principal

| Comando                                                   | Resultado | Detalle                                                                                                                             |
| --------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                           | ✅ exit 0 | format:check, lint, typecheck, build y vitest: **80 archivos / 319 tests OK**, 1 archivo omitido (integración MSIX gateada por env) |
| `RUN_INKSCAPE_INTEGRATION=1 vitest run tests/integration` | ✅        | 1/1: descubre y sondea el Inkscape MSIX instalado                                                                                   |
| `node dist/cli.js --doctor --json`                        | ✅        | Inkscape 1.4.4 MSIX, `support: stable`, `pages_v14`, 189 actions, 17 exportadores de extensión                                      |

Capacidades que reporta el doctor en esta máquina: PNG, DXF, FXG, SIF y HPGL disponibles. **GPL, JPEG, TIFF y WebP no disponibles** ("output is missing or unreadable"). El servidor las anuncia como ausentes, en coherencia con la invariante "capability ausente → error recuperable".

### 2.2 Puertas end-to-end (Inkscape real)

Se ejecutaron todos los scripts `test:*` de `package.json` salvo `test`/`test:unit` (ya cubiertos por `check`) y `test:conformance` (requiere herramienta externa).

| Puerta                                                                                                                                          | Resultado                        | Tiempo                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `test:integration`                                                                                                                              | ✅                               | 2 s                                                                      |
| `test:cli` (CLI autónoma)                                                                                                                       | ✅                               | 29 s                                                                     |
| `test:windows` (automatización Windows)                                                                                                         | ✅                               | 23 s                                                                     |
| `test:mcp` (stdio moderno + legacy, E2E principal)                                                                                              | ⚠️ falló 1/2 · ✅ en aislamiento | 44 s                                                                     |
| `test:f03-g08`, `test:f03-g09` (CSS resize, page settings)                                                                                      | ✅ ✅                            | 2 s / 4 s                                                                |
| `test:f04-g01…g04` (inventario, preflight, preview, solo-lectura)                                                                               | ✅ ×4                            | 1–10 s                                                                   |
| `test:f05-g02…g13` (fondos PNG, PDF multipágina, reapertura SVG, lotes, cancelación, Inspector, MVP E2E, subset PDF, selección visual, viewBox) | ✅ ×12                           | 4–31 s                                                                   |
| `test:f08-g02`, `g03`, `g06` (capabilities ausentes, presets, fingerprint)                                                                      | ✅ ×3                            | 8–33 s                                                                   |
| `test:f09-wp01…wp05` (catálogo, recursos/prompts, jobs, compatibilidad, logging/telemetría)                                                     | ✅ ×5                            | 1–40 s                                                                   |
| `test:f10-windows-baseline`                                                                                                                     | ✅                               | 23 s                                                                     |
| `test:f10-inspector`                                                                                                                            | ⏭️ no aplicable                  | el script reporta que Inspector/conformance aún no soportan HTTP moderno |
| `test:pack` (smoke del paquete npm)                                                                                                             | ✅                               | vía `npm run`; requiere `npm_execpath`                                   |

**Total: 31/31 puertas ejecutables en verde en aislamiento; 1 no aplicable.**

### 2.3 Pruebas de concepto contra el servidor real

Se arrancó `dist/cli.js --workspace-root <tmp>` con el cliente MCP oficial. Se colocó `secret.png` (rojo puro) **fuera** del workspace y se llamó a `export_png` con `dpi: 96`:

```text
EXPORT control.svg:         ok, center pixel rgba=255,255,255,255   (blanco esperado)
EXPORT standard-xlink.svg:  rejected -> Native export input violates the SVG safety policy   (defensa OK)
EXPORT prefixed-xlink.svg:  ok, center pixel rgba=255,0,0,255       ← el PNG contiene el archivo externo
EXPORT absref.svg:          ok, center pixel rgba=255,0,0,255       ← el PNG contiene el archivo externo
EXPORT stylesheet-pi.svg:   ok, center pixel rgba=255,255,255,255   (Inkscape no aplicó la PI)
UNKNOWN PROP on workspace_list_documents: isError=true "Unrecognized key: \"bogusField\""
UNKNOWN PROP on export_png (superRefine):  isError=true "Unrecognized key: \"bogusField\""
LEAK after root removal: isError=true containsAbsolutePath=true
  message="ENOENT: no such file or directory, realpath 'C:\\Users\\LENOVO\\AppData\\Local\\Temp\\poc-ws-…'"
```

PoC unitaria del sanitizador (`sanitizeSvg` / `createNativeInputBundle` sobre `dist/`):

```text
prefixedXlink   [strict|preserve-local] removed=[]          ← bypass
uncHref         [preserve-local]        removed=[]          ← no filtrado (el bundle sí lo rechaza)
absref          [strict|preserve-local] removed=[]          ← bypass
xmlStylesheetPI [strict]                PI conservada
smilHref        [strict]                removed=[]          ← javascript: vía <set>
cssEscape       [strict]                removed=[]          ← u\72l(http://…)
```

---

## 3. Hallazgos

### Crítica

#### C-01 — Lectura de archivos fuera del workspace vía `xl:href` (prefijo XLink alternativo) y `sodipodi:absref`

- **Archivos:** [src/svg/safe-dom.ts:145-147](../../../src/svg/safe-dom.ts#L145-L147), [src/storage/native-input.ts:187-203](../../../src/storage/native-input.ts#L187-L203), [src/storage/native-input.ts:376-381](../../../src/storage/native-input.ts#L376-L381)
- **Estado:** **CONFIRMADO END-TO-END** con Inkscape 1.4.4: el PNG exportado contiene los píxeles de un archivo externo al workspace (§2.3).
- **Descripción:**
  - `isDirectReferenceAttribute` compara el nombre literal del atributo con `"href" | "xlink:href" | "src"`. En XML el prefijo es arbitrario: `xmlns:xl="http://www.w3.org/1999/xlink"` + `xl:href="file:///…"` equivale a `xlink:href`, pero no lo inspeccionan ni `sanitizeSvg` (en ningún modo, incluido `strict`) ni `collectLocalReferences`/`rewriteReferences` del bundle.
  - `sodipodi:absref`, el fallback que Inkscape usa cuando el `href` de un `<image>` no carga, tampoco se revisa.
  - En ambos casos el bundle se acepta con 0 dependencias y el SVG staged conserva la referencia original.
- **Impacto:** quien controle el contenido de un SVG del workspace puede hacer que cualquier archivo legible por el usuario del proceso termine dentro de un PNG/PDF exportado (exfiltración). Con `http(s)://` o `\\host\share` también hay riesgo de SSRF o de fuga del hash NTLM en Windows (no probado en red). Viola las invariantes de roots canónicos y de "sin recursos remotos por defecto".
- **Recomendación:**
  - Clasificar las referencias por `(namespaceURI, localName)`: `href` sin namespace o con el namespace XLink, y `src` sin namespace.
  - Tratar `sodipodi:absref` (y cualquier `*:absref`) como prohibido, o eliminarlo en staging.
  - Usar una sola función compartida por `safe-dom.ts` y `native-input.ts`.
  - Convertir las PoC de §2.3 en tests de regresión (unitarios y de puerta).

### Alta

#### A-01 — Los errores internos de Node (con rutas absolutas) se devuelven al cliente MCP

- **Archivos:** p. ej. [src/server/index.ts:1288](../../../src/server/index.ts#L1288) (`WorkspaceService.create` → `realpath` de los roots en cada llamada), [src/server/index.ts:1813](../../../src/server/index.ts#L1813), [src/workspace/service.ts:120](../../../src/workspace/service.ts#L120), [src/server/jobs.ts](../../../src/server/jobs.ts) (`error.message` en jobs fallidos).
- **Estado:** **CONFIRMADO END-TO-END**: al borrar el root tras arrancar, `workspace_list_documents` devolvió `ENOENT … realpath 'C:\Users\LENOVO\AppData\Local\Temp\poc-ws-…'`.
- **Descripción:** los handlers lanzan errores crudos y el SDK v2 los convierte en `createToolError(error.message)`; no hay ningún mapeador intermedio. Otros casos reales en Windows: `EBUSY` cuando el SVG está abierto en Inkscape, y `EPERM`/`EEXIST` en `mkdir` u `open(...,'wx')`.
- **Impacto:** viola "No publiques paths absolutos … en logs/resultados" y revela el nombre de usuario y la estructura del host.
- **Recomendación:** envolver todo handler (tools, recursos, jobs) en un mapeador a códigos estables (`PATH_*`, `REVISION_CONFLICT`, `CAPABILITY_ABSENT`, `INTERNAL`) con `redactDiagnostic`. Añadir un test que fuerce `ENOENT`/`EBUSY` y verifique que no aparecen rutas absolutas.

### Media

#### M-01 — Otras referencias externas que el sanitizador no cubre (UNC, PI `xml-stylesheet`, escapes CSS, `xml:base`)

- **Archivos:** [src/svg/safe-dom.ts:32](../../../src/svg/safe-dom.ts#L32), [src/svg/safe-dom.ts:134-155](../../../src/svg/safe-dom.ts#L134-L155)
- **Estado:**
  - Confirmado que pasan el sanitizador.
  - La PI `xml-stylesheet` con `file://` **no** fue aplicada por Inkscape 1.4.4 en la prueba.
  - UNC y `http(s)` no se probaron en red.
- **Detalle:**
  1. En `preserve-local`, `href="\\attacker\share\a.png"` no se filtra, porque la lista negra solo cubre `https?:|file:|data:|javascript:|//`. El bundle nativo sí lo rechaza, pero el SVG sanitizado puede publicarse (import/export SVG).
  2. Las processing instructions se conservan.
  3. `u\72l(…)` y `xml:base` evaden la detección por regex.
- **Recomendación:** pasar a una **allowlist**: `#frag`, rutas relativas validadas y `data:image/*`. Además, eliminar las PI salvo la declaración XML y normalizar los escapes CSS antes de analizar.

#### M-02 — Lectura completa de documentos sin verificar tamaño; límite fijo de 50 MiB que ignora la configuración

- **Archivos:** 64 llamadas `readFile(document.absolutePath, …)` en `server/index.ts`; 42 sitios con `maxInputBytes: 50 * 1024 * 1024` codificado (`documents/*`, `export/*`, `svg/*`, `geometry/bounds.ts`, `storage/native-input.ts:109`).
- **Descripción:** el archivo se carga entero en memoria **antes** de que `sanitizeSvg` lo rechace por tamaño, así que un SVG de varios GB provoca OOM. Además `config.maxInputBytes` no se respeta: bajarlo no protege y subirlo no tiene efecto.
- **Recomendación:** un helper único `readBoundedSvg(resolved, config)` con `stat` previo y lectura acotada.

#### M-03 — `maximumSanitizeMode` no se aplica en las tools de documento

- **Archivos:** ~40 módulos con `mode: "preserve-local"` codificado y sin `maximumMode`.
- **Descripción:** con `maximumSanitizeMode: "strict"`, las tools de mutación/inspección siguen aceptando `foreignObject` y referencias relativas, y las reescriben en el documento.
- **Recomendación:** derivar el modo de `config.maximumSanitizeMode` en el helper de M-02.

#### M-04 — `taskkill` resuelto por búsqueda de PATH y sin verificar su resultado

- **Archivo:** [src/runner/run.ts:263-274](../../../src/runner/run.ts#L263-L274)
- **Descripción:** se invoca `"taskkill.exe"` sin ruta absoluta (libuv busca primero en el directorio actual) y se ignora su código de salida. Los procesos desacoplados del árbol no se terminan; `AGENTS.md` pide Job Object o equivalente (limitación ya documentada en `docs/architecture/process-runner.md`).
- **Recomendación:** usar `%SystemRoot%\System32\taskkill.exe`, comprobar `exitCode` y planificar el helper con Job Object.

#### M-05 — En POSIX solo se mata el hijo directo y el runner puede quedar colgado

- **Archivo:** [src/runner/run.ts:245-261](../../../src/runner/run.ts#L245-L261), [src/runner/run.ts:181-183](../../../src/runner/run.ts#L181-L183)
- **Descripción:** sin grupo de procesos, los nietos sobreviven. Como `finish` espera al evento `close`, un nieto que herede los pipes deja la promesa pendiente indefinidamente y retiene el slot del semáforo.
- **Recomendación:** `detached` + `kill(-pid)` y un _hard deadline_ que destruya los streams.

#### M-06 — Almacén de artefactos sin cuota total y con expiración perezosa

- **Archivo:** [src/storage/artifacts.ts:54-92](../../../src/storage/artifacts.ts#L54-L92), [:167-175](../../../src/storage/artifacts.ts#L167-L175)
- **Descripción:** no hay límite de número ni de bytes totales. `removeExpired` solo corre cuando se invoca, y tras un reinicio los archivos quedan huérfanos hasta la limpieza de scratch de 24 h.
- **Recomendación:** cuota global y por owner, barrido periódico y limpieza al arrancar.

#### M-07 — Backups in-place sin retención

- **Archivo:** [src/storage/revisions.ts:173-176](../../../src/storage/revisions.ts#L173-L176), [:349-351](../../../src/storage/revisions.ts#L349-L351)
- **Descripción:** cada mutación in-place crea `doc.svg.bak-<ts>-<uuid>` dentro del workspace, sin límite.
- **Recomendación:** política de retención (N/TTL) o backups en scratch controlado.

#### M-08 — Locks solo intra-proceso

- **Archivo:** [src/storage/revisions.ts:51-89](../../../src/storage/revisions.ts#L51-L89)
- **Descripción:** `CanonicalPathLocks` vive en memoria, así que los servidores stdio/HTTP y la CLI de recetas/cola no se coordinan entre sí sobre el mismo workspace.
- **Recomendación:** lock de archivo, o documentar "un proceso por workspace".

#### M-09 — Probe de capacidades no determinista bajo carga (puerta `test:mcp` intermitente)

- **Archivos:** [src/capabilities/service.ts:69-74](../../../src/capabilities/service.ts#L69-L74), [:147-178](../../../src/capabilities/service.ts#L147-L178), [scripts/test-mcp.mjs:104-115](../../../scripts/test-mcp.mjs#L104-L115)
- **Estado:** **CONFIRMADO** (reproducido).
- **Descripción:**
  - En 4 llamadas consecutivas a `inkscape_status`, una devolvió `warnings: ["INKSCAPE_ACTION_LIST_UNAVAILABLE"]`, sin relación con el modo legacy o moderno.
  - Durante la ejecución completa de puertas, `test:mcp` falló por ese motivo con el mensaje `legacy: inkscape_status did not recognize the verified 1.4.4 pages_v14 baseline`. En aislamiento pasó.
  - El probe lanza `--help-all`, `--list-input-types` y `--action-list` en paralelo, sin reintento y con timeout fijo de 30 s.
  - Cada `inkscape_status` en frío tarda unos **23 s**.
- **Impacto:** un cliente puede ver capacidades distintas entre llamadas, y la puerta E2E principal es inestable.
- **Recomendación:** reintentar una vez ante fallo transitorio, registrar `terminationReason`/`exitCode` en la observación y no cachear un fallo como estado definitivo. En el test, tolerar o reintentar ese warning concreto.

#### M-10 — El sanitizador no neutraliza SMIL que reescribe `href`

- **Archivo:** [src/svg/safe-dom.ts:59-91](../../../src/svg/safe-dom.ts#L59-L91)
- **Estado:** CONFIRMADO (PoC).
- **Descripción:** `<set attributeName="href" to="javascript:…">` sobrevive incluso en `strict`. No afecta al render de Inkscape, pero los SVG exportados quedan con XSS al abrirse en un navegador.
- **Recomendación:** inspeccionar `to/from/values/by` de las animaciones, o eliminarlas en `strict`.

### Baja

| ID   | Archivo                                                                                                                     | Descripción                                                                                                                                                                                      | Recomendación                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| B-01 | [http.ts:132](../../../src/http.ts#L132)                                                                                    | El rate limiter usa una clave global y se aplica **antes** de autenticar, así que un proceso local sin token agota el cupo (120/min) del cliente legítimo.                                       | Limitar por separado a los no autenticados y por `clientId` tras autenticar. |
| B-02 | [http.ts:378-379](../../../src/http.ts#L378-L379)                                                                           | `once(response, "drain")` no compite con `close`: si el cliente se desconecta con backpressure, el stream SSE queda colgado.                                                                     | `Promise.race` con `close`/`error` + `reader.cancel()`.                      |
| B-03 | [http.ts:251-253](../../../src/http.ts#L251-L253)                                                                           | El archivo de tokens se lee completo, en cada petición, antes de comprobar el límite de 64 KiB.                                                                                                  | Lectura acotada y cache invalidada por `mtime`.                              |
| B-04 | [workspace/service.ts:148](../../../src/workspace/service.ts#L148), [:244-259](../../../src/workspace/service.ts#L244-L259) | `listDocuments` recorre **todo** el workspace en cada página, sin límite de profundidad ni de entradas.                                                                                          | Límites y recorrido incremental.                                             |
| B-05 | `package.json`                                                                                                              | `npm audit --omit=dev` marca una vulnerabilidad **alta** en `@modelcontextprotocol/client` 2.0.0 (GHSA-6qxp-vccf-f47h, OAuth). Solo se usa por stdio sin OAuth, así que el impacto real es bajo. | Actualizar a ≥ 2.3.1 tras validar la compatibilidad.                         |
| B-06 | [workspace/service.ts:170-198](../../../src/workspace/service.ts#L170-L198)                                                 | No se rechazan nombres reservados de Windows (`CON`, `NUL`, …) ni segmentos con punto o espacio final.                                                                                           | Rechazarlos explícitamente.                                                  |
| B-07 | [workspace/service.ts:207](../../../src/workspace/service.ts#L207)                                                          | `sniffSvgDocument` lee el archivo completo para mirar solo 8 KiB.                                                                                                                                | `open` + `read` acotado.                                                     |

### Informativo

- **I-01 — `server/index.ts` tiene 11 509 líneas** con 90 tools. Ese tamaño es el origen de las inconsistencias de M-02/M-03 e I-05. Conviene dividirlo por dominio, con un `registerSecureTool` común que aplique el mapeo de errores (A-01), la lectura acotada y el schema estricto.
- **I-02 — Patrón duplicado "sanitizar y luego re-parsear `source`"** en ~40 módulos (p. ej. [documents/flowed-text.ts:119-127](../../../src/documents/flowed-text.ts#L119-L127)). Conviene centralizarlo en `parseSafeSvg()`.
- **I-03 — `AtomicFileStore` decide por veracidad de `expectedOutputRevision`** ([revisions.ts:154](../../../src/storage/revisions.ts#L154)): un `""` saltaría la verificación. Hoy los schemas lo impiden, pero conviene validar el formato también en storage.
- **I-04 — Modelo HTTP multi-principal:** todos los tokens ven todos los `workspaceRoots`. El aislamiento por owner cubre artefactos, jobs y snapshots, pero no los documentos. Conviene documentarlo en `SECURITY.md`.
- **I-05 — (antes A-03, falso positivo)** El análisis AST contó 43 de 90 `inputSchema` escritos como `z.object(...)` sin `.strict()`. En realidad [src/server/index.ts](../../../src/server/index.ts) redefine localmente `const z = { ...baseZ, object: baseZ.strictObject }`, así que **todos** los schemas son estrictos, como confirman los `Unrecognized key` de §2.3. No requiere cambio.

## 4. Aspectos positivos verificados

- El resolver de rutas rechaza rutas absolutas, UNC, unidades, `..`, `.`, `:` y NUL, y canonicaliza con `realpath`. Las puertas F04-G04 (solo-lectura) y F05 lo ejercitan.
- La referencia `xlink:href` estándar a un archivo externo **se rechaza correctamente** en la exportación nativa (§2.3). El fallo de C-01 está solo en la forma de identificar el atributo.
- La publicación es atómica (`wx` + `fsync` + `rename`), rechaza destinos symlink, revalida el padre y hace rollback de lotes. Las puertas F05-G05 (recuperación) y F05-G06 (cancelación/reinicio) lo confirman.
- Las capacidades ausentes (GPL/JPEG/TIFF/WebP en esta máquina) se reportan como no disponibles en lugar de simular éxito (F08-G02 ✅).
- El runner usa `shell: false`, entorno mínimo, límites, timeout y abort; la terminación del árbol en Windows está cubierta por `runner.test.ts`.
- HTTP escucha en `127.0.0.1` con bearer obligatorio, comparación en tiempo constante y validación de Host/Origin.
- stdout está reservado a MCP (F09-WP05 ✅).

## 5. Prioridad de remediación sugerida

1. **C-01** (y M-01 en el mismo cambio): clasificar las referencias por namespace con una allowlist compartida entre el sanitizador y el bundle, y añadir regresiones E2E basadas en §2.3.
2. **A-01**: mapeador de errores común a todas las tools, recursos y jobs.
3. **M-09**: estabilizar el probe de capacidades para que `test:mcp` sea determinista.
4. **M-02/M-03**: helper `readBoundedSvg` que respete `maxInputBytes` y `maximumSanitizeMode`.
5. **M-04/M-05** (runner) y **M-06/M-07** (cuotas y retención).
6. El resto según capacidad; I-01 como refactor habilitante.

## 6. Limitaciones

- `server/index.ts` y los módulos de `documents/`/`export/` se revisaron por patrones, no línea a línea. La validación de su funcionalidad se apoya en la suite existente (319 tests + 31 puertas).
- No se probó carga de red (UNC/HTTP) desde Inkscape, ni plataformas macOS/Linux (M-05 es por lectura de código).
- `test:conformance` y `test:f10-inspector` no se ejecutaron o no aplican (herramienta externa / HTTP moderno no soportado por el inspector).
- `test:pack` falla si se invoca fuera de `npm run` (requiere `npm_execpath`); por `npm run test:pack` pasa.
- Las PoC se ejecutaron en directorios temporales fuera del repo y no modificaron el código.

## 7. Estado de la remediación (2026-10-07)

Decisiones del usuario antes de corregir: conservar los **10 backups** más recientes por documento (M-07), **actualizar** el SDK MCP (B-05) y **dejar fuera** los refactors I-01/I-02.

| ID   | Estado              | Corrección                                                                                                                                                                                         | Prueba                                                                                       |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| C-01 | ✅ Corregido        | `svgReferenceAttributeKind` (namespace/localName) compartido por sanitizador, bundle nativo, IDs, inventario y shapes; el bundle elimina `sodipodi:absref` de la copia staged.                     | `safe-svg.test.ts`, `storage.test.ts`; PoC E2E: `xl:href` rechazado, `absref` → píxel blanco |
| A-01 | ✅ Corregido        | `src/server/public-errors.ts`: `withPublicErrors` en todas las tools/recursos y `publicErrorMessage` en jobs; `redactDiagnostic` también redacta rutas POSIX.                                      | `public-errors.test.ts` (incluye llamada stdio real); PoC E2E sin ruta                       |
| M-01 | ✅ Corregido        | Allowlist en `preserve-local` (UNC/esquemas fuera), PIs eliminadas, `xml:base` eliminado, escapes CSS decodificados.                                                                               | `safe-svg.test.ts`; PoC E2E: PI rechazada                                                    |
| M-02 | ✅ Corregido        | `readBoundedFile`/`readBoundedText` en las ~70 lecturas de documentos de cliente; `configureSvgSecurityPolicy` aplica `config.maxInputBytes`.                                                      | `workspace.test.ts`, `safe-svg.test.ts`                                                      |
| M-03 | ✅ Corregido        | La misma política aplica `maximumSanitizeMode` como techo a todas las llamadas.                                                                                                                    | `safe-svg.test.ts`                                                                           |
| M-04 | ✅ Corregido        | `taskkill.exe` desde `%SystemRoot%\System32`. Job Object kill-on-close con un lanzador + `koffi` (ADR-012, aprobado por el usuario): el árbol entra en el job antes del `spawn`.                   | `runner.test.ts` (huérfano desacoplado y servidor muerto con SIGKILL); E2E con Inkscape      |
| M-05 | ✅ Corregido        | Grupo de procesos en POSIX (`detached` + `kill(-pid)`) y deadline de 5 s tras terminar (también en Windows).                                                                                       | `runner.test.ts` (descendiente huérfano con pipe abierto)                                    |
| M-06 | ✅ Corregido        | Cuota de 1.000 artifacts y 4 × `maxArtifactBytes`, con barrido de huérfanos de más de 24 h.                                                                                                        | `storage.test.ts`                                                                            |
| M-07 | ✅ Corregido        | Retención de 10 backups por documento; solo se tocan nombres `<archivo>.bak-<ISO>-<id>`.                                                                                                           | `storage.test.ts`                                                                            |
| M-08 | ✅ Corregido        | Locks de archivo en `<scratch>/inkscape-mcp-locks`, con recuperación de locks de procesos muertos y timeout de 60 s.                                                                               | `storage.test.ts`                                                                            |
| M-09 | ✅ Corregido        | Un reintento ante fallos transitorios del probe, sin cachear fallos. Además, `test:mcp` tenía una espera de cancelación demasiado justa (también falla con `5cc6498`): pasa a un deadline de 10 s. | `capabilities.test.ts`; `test:mcp` en verde                                                  |
| M-10 | ✅ Corregido        | Se eliminan `set`/`animate*` que asignan referencias prohibidas.                                                                                                                                   | `safe-svg.test.ts`                                                                           |
| B-01 | ✅ Corregido        | Rate limit por principal y cupo separado para no autenticados.                                                                                                                                     | `http.test.ts`                                                                               |
| B-02 | ✅ Corregido        | `drain` compite con `close` y el reader se cancela cuando el cliente se desconecta.                                                                                                                | Tests HTTP E2E existentes (streams normales); sin test específico de desconexión             |
| B-03 | ✅ Corregido        | `stat` previo (64 KiB) y caché por `ino`/`mtime`/`size`; la rotación sigue sin reinicio.                                                                                                           | `http.test.ts`                                                                               |
| B-04 | ✅ Corregido        | Listado limitado a 100.000 entradas y 32 niveles, con error recuperable.                                                                                                                           | `workspace.test.ts`                                                                          |
| B-05 | ✅ Corregido        | SDK 2.3.1, Inspector 2.9.0 y `npm audit fix`: **0 vulnerabilidades** (completo y runtime).                                                                                                         | `npm audit`; check y puertas E2E                                                             |
| B-06 | ✅ Corregido        | Se rechazan `CON/NUL/COM¹…` con cualquier extensión y los segmentos con punto o espacio final.                                                                                                     | `workspace.test.ts`                                                                          |
| B-07 | ✅ Corregido        | El sniff lee 8 KiB con un handle.                                                                                                                                                                  | `workspace.test.ts`                                                                          |
| I-01 | ⏸️ Fuera de alcance | Refactor estructural excluido por decisión del usuario.                                                                                                                                            | —                                                                                            |
| I-02 | ⏸️ Fuera de alcance | Ídem; la política global (M-02/M-03) reduce el riesgo del patrón duplicado.                                                                                                                        | —                                                                                            |
| I-03 | ✅ Corregido        | `AtomicFileStore` valida el formato SHA-256 y usa `!== undefined`.                                                                                                                                 | `storage.test.ts`                                                                            |
| I-04 | ✅ Documentado      | `SECURITY.md` y `docs/security-workspace-guide.md` explican el alcance de los tokens HTTP.                                                                                                         | —                                                                                            |
| I-05 | ✅ Sin acción       | Falso positivo: `z.object` ya es `z.strictObject` en `server/index.ts`.                                                                                                                            | PoC E2E (`Unrecognized key`)                                                                 |

**Verificación final:**

- `npm run check` en verde: 81 archivos y 344 tests.
- 31/31 puertas E2E ejecutables en verde con Inkscape 1.4.4.
- `npm audit`: 0 vulnerabilidades.
- PoC de §2.3 repetida contra el servidor real: ya no hay exfiltración ni rutas en los errores.

Los cambios quedan sin commit, y el registro de progreso está en `docs/progress/F11.md`.
