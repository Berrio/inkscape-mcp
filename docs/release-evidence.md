# Evidencia de release local

El repositorio puede generar un conjunto verificable de artefactos sin publicar
nada. Tras una batería limpia, ejecuta:

```powershell
npm run check
npm run test:pack
npm run release:provenance
```

El último comando exige un árbol Git rastreado limpio y crea
`artifacts/releases/<version>/` (ignorado por Git) con:

- el `.tgz` instalado por npm;
- el SBOM SPDX generado desde el lockfile;
- `provenance.json` con commit, versiones de Node/npm y hashes del tarball/SBOM;
- `SHA256SUMS` que incluye hashes SHA-256 del tarball, SBOM y provenance.

Para guardarlo fuera de la ruta predeterminada sin salir del repositorio:

```powershell
node scripts/release-provenance.mjs --output-directory artifacts/releases/0.1.0-candidate
```

No sobrescribe un directorio de evidencia existente. Si cambia código, lockfile
o metadata, incrementa la versión, ejecuta las verificaciones de nuevo y genera
otro directorio. El SBOM contiene su propia fecha de generación; por ello se
conserva como evidencia del artefacto exacto y se verifica mediante
`SHA256SUMS`.

Este comando no ejecuta `npm publish`, no crea tags y no registra el servidor
en MCP Registry. Esas acciones requieren autorización explícita y se realizan
sólo después de revisar los hashes y el paquete local.
