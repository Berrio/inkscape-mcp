# Inventario inicial de dependencias

Actualizado: 2026-10-07 (SDK MCP 2.3.1 e Inspector 2.9.0 por advisories). Las versiones directas se fijan en `package.json` y el grafo exacto en `package-lock.json`.

| Paquete                                 | Versión | Uso                                 | Licencia declarada | Riesgo inicial                                                                     |
| --------------------------------------- | ------: | ----------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `@modelcontextprotocol/server`          |   2.3.1 | Servidor MCP                        | MIT                | Protocolo/transporte; no habilitar HTTP sin F10                                    |
| `@modelcontextprotocol/client`          |   2.3.1 | Pruebas de transporte/negociación   | MIT                | Runtime de la CLI autónoma (stdio, sin OAuth)                                      |
| `@modelcontextprotocol/conformance`     |  0.1.16 | Conformance fijada                  | MIT                | Solo desarrollo                                                                    |
| `@modelcontextprotocol/inspector`       |   2.9.0 | Inspector fijado                    | MIT                | Tiene postinstall pendiente de aprobación; no se ejecutó                           |
| `koffi`                                 |   3.3.2 | FFI Win32 para Job Object (ADR-012) | MIT                | Código nativo precompilado; su script de instalación no se ejecuta ni es necesario |
| `@opentelemetry/api`                    |   1.9.1 | API de trazas HTTP locales          | Apache-2.0         | Sin exporter remoto ni payloads                                                    |
| `@opentelemetry/sdk-trace-base`         |  2.10.0 | Trazas HTTP estructuradas           | Apache-2.0         | Exportador allowlisted sólo a stderr                                               |
| `zod`                                   |   4.4.3 | Schemas de dominio                  | MIT                | Validación de inputs                                                               |
| `typescript`                            |   6.0.3 | Compilación                         | Apache-2.0         | Solo desarrollo                                                                    |
| `vitest`                                |  4.1.11 | Pruebas                             | MIT                | Solo desarrollo                                                                    |
| `eslint`/`typescript-eslint`/`prettier` | fijadas | Calidad/formato                     | MIT                | Solo desarrollo                                                                    |

No se compila ningún addon nativo propio. La única dependencia con código nativo es `koffi`, cuyos binarios precompilados se usan para el Job Object de Windows (ADR-012). Inkscape se mantiene como dependencia externa del sistema y se ejecutará únicamente mediante el runner controlado de F01. Antes de cada release se ejecutarán auditoría, SBOM y revisión de licencias conforme a F11.
