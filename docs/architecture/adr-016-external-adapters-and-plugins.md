# ADR-016: adaptadores externos y API de plugins internos allowlisted

## Estado

Aceptada el 2026-10-07 (F12-T08 evaluación, F12-T09 diseño). No se añade ningún adaptador externo ni plugin en 1.0.

## Adaptadores externos de optimización y render (F12-T08)

Herramientas candidatas: Scour, SVGO, resvg, rsvg-convert, CairoSVG, ImageMagick. En este host **ninguna está en `PATH`** (verificado el 2026-10-07). El exportador INX `output_scour` de Inkscape tampoco puede ejecutarse sin `scour` (F08-T16).

Reglas para cualquier adaptador futuro:

1. **Nunca sustituir a Inkscape en silencio.** Un adaptador es una operación distinta con su propio nombre y versión (`<herramienta>-<operación>/vN`), y su uso aparece en el resultado y en el manifest. Si falta, la tool devuelve un error recuperable y nunca recurre a Inkscape sin avisar.
2. **Descubrimiento sólo por configuración de arranque** (ruta del ejecutable o proveedor interno), igual que Inkscape. Ninguna tool acepta una ruta de ejecutable ni flags.
3. **Capability gate con probe real.** Se ejecuta sobre un fixture fijo y se verifica la estructura del resultado, como hacen DXF, FXG, SIF y GPL.
4. **Regresión visual obligatoria** para optimizadores: el render del resultado debe coincidir con el original dentro de la tolerancia de `comparePngVisual`. Un optimizador que cambie la apariencia se rechaza.
5. Mismo runner, Job Object, timeout, límites de salida y staging que Inkscape.

## API de plugins internos (F12-T09)

- Los plugins son **módulos compilados con el servidor**, registrados en una tabla estática. No hay carga dinámica desde rutas, URLs, `require` de nombres aportados por el cliente ni paquetes descubiertos en tiempo de ejecución.
- Descriptor de cada plugin:
  - `id` estable y versionado;
  - schemas de entrada y salida (Zod estricto);
  - capacidades nativas requeridas (flags, adapters);
  - anotaciones MCP;
  - el handler.
- El catálogo MCP sigue siendo determinista: el fingerprint de `mcp-compatibility.test.ts` cubre las tools que aporta cada plugin.
- Un plugin no recibe el runner, el filesystem ni rutas absolutas en crudo. Recibe los mismos servicios que las tools: workspace con resolver seguro, `AtomicFileStore`, `createNativeInputBundle` y el runner con `argv` construido por el propio plugin a partir de enums.
- Habilitación sólo por configuración de arranque (allowlist de IDs), nunca por una tool.

## Consecuencias

El catálogo y la superficie de ejecución de 1.0 no cambian. Cualquier adaptador o plugin futuro debe cumplir F12-G01 (ADR, threat model, capability gate, tests y documentación) antes de publicarse.
