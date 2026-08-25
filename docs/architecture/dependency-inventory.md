# Inventario inicial de dependencias

Actualizado: 2026-08-25. Las versiones directas se fijan en `package.json` y el grafo exacto en `package-lock.json`.

| Paquete                                 | Versión | Uso                               | Licencia declarada | Riesgo inicial                                           |
| --------------------------------------- | ------: | --------------------------------- | ------------------ | -------------------------------------------------------- |
| `@modelcontextprotocol/server`          |   2.0.0 | Servidor MCP                      | MIT                | Protocolo/transporte; no habilitar HTTP sin F10          |
| `@modelcontextprotocol/client`          |   2.0.0 | Pruebas de transporte/negociación | MIT                | Solo desarrollo                                          |
| `@modelcontextprotocol/conformance`     |  0.1.16 | Conformance fijada                | MIT                | Solo desarrollo                                          |
| `@modelcontextprotocol/inspector`       |   2.3.0 | Inspector fijado                  | MIT                | Tiene postinstall pendiente de aprobación; no se ejecutó |
| `zod`                                   |   4.4.3 | Schemas de dominio                | MIT                | Validación de inputs                                     |
| `typescript`                            |   6.0.3 | Compilación                       | Apache-2.0         | Solo desarrollo                                          |
| `vitest`                                |  4.1.11 | Pruebas                           | MIT                | Solo desarrollo                                          |
| `eslint`/`typescript-eslint`/`prettier` | fijadas | Calidad/formato                   | MIT                | Solo desarrollo                                          |

No se añadió ningún addon nativo directo. Inkscape se mantiene como dependencia externa del sistema y se ejecutará únicamente mediante el runner controlado de F01. Antes de cada release se ejecutarán auditoría, SBOM y revisión de licencias conforme a F11.
