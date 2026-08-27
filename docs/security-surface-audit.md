# Revisión manual de superficie de ataque

Revisión realizada el 2026-08-27 sobre la rama de release Windows/stdio.
Alcance: todo uso de filesystem, proceso nativo y XML/SVG bajo `src/`.

| Superficie         | Revisión                                                                | Controles confirmados                                                                                                                                           | Límite residual                                                                                                        |
| ------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Rutas y filesystem | `workspace`, `storage`, `preview`, `artifacts`, `snapshots` y handlers  | rutas públicas relativas, roots canonizados, revisiones, locks, staging, backup y publicación por rename                                                        | Node no elimina por sí solo una carrera contra un actor local que altere reparse points; los roots deben ser privados. |
| Procesos           | `runner/run.ts`, discovery, capabilities y adaptadores                  | único `spawn`, `shell: false`, argv tipado, CWD, entorno mínimo, timeout, aborto, límites de salida y `taskkill /T /F` en Windows                               | un proceso que se desacople requiere Job Object/helper nativo; no se mata un PID tras reinicio por heurística.         |
| XML/SVG            | sanitizador y módulos `documents`, `svg`, `import`, `export`, `storage` | sin DTD/entidades/CDATA, límite de bytes/nodos/profundidad, sin scripts/events/URLs remotas por defecto, ceiling de sanitización y validación antes de publicar | Inkscape/Poppler/codecs no están aislados: sólo se aceptan inputs locales confiables en 1.0.                           |
| Recursos locales   | bundle nativo, imágenes y assets de selección                           | copia/hash en staging, URIs locales reescritas, límites de bytes y revalidación antes de commit                                                                 | no se descarga red ni se interpreta una ruta aportada fuera del workspace.                                             |

## Corrección resultante

La revisión encontró que `rewriteStagedAssetReferences` analizaba el SVG de
salida antes de verificar su política. Ahora lo sanitiza primero y falla si
hubiera elementos o referencias prohibidas. La prueba de publicación de assets
cubre script y URL remota.

## Método reproducible

```powershell
rg -n "\b(spawn|execFile|exec\(|execSync|spawnSync)\b" src -g "*.ts"
rg -n "\b(readFile|writeFile|rename|rm|mkdtemp|copyFile|opendir|realpath)\b" src -g "*.ts"
rg -n "DOMParser|XMLSerializer|parseFromString|sanitizeSvg" src -g "*.ts"
npm run check
```

La revisión no declara sandbox de parsers nativos. Esa garantía exige el
trabajo opcional de aislamiento del sistema operativo, no una validación
adicional de JavaScript.
