# ADR-004: Workspaces, rutas relativas y URIs opacas

## Estado

Aceptada el 2026-08-25.

## Decisión

- Las tools aceptan rutas relativas a `workspaceRoots` o IDs/URIs opacos.
- Rechazan rutas absolutas, UNC, drive-relative, NUL, ADS de NTFS y traversal.
- `scratchRoot` pertenece al servidor y no es navegable por clientes.
- Ejecutable, fuentes, data dirs y extensiones son dependencias internas de solo lectura; no se publican como roots.
- Los resultados nunca exponen paths absolutos y usan `inkscape://...`.

## Consecuencias

La resolución canónica, los rechecks antes de commit y el modelo TOCTOU se implementan en F02. Esta decisión no promete resistencia contra un atacante local concurrente sin helper/sandbox adicional.
