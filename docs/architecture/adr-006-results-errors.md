# ADR-006: Resultados, warnings y errores de dominio

## Estado

Aceptada el 2026-08-25.

## Decisión

Toda tool devuelve `structuredContent` validado y texto breve compatible. El resultado de dominio es una unión discriminada:

- `ok`: contiene datos y ningún fallo.
- `partial`: solo para contratos `best_effort`; conserva `isError: false` y detalla fallos por item.
- `error`: `isError: true`, código estable, remediation opcional y detalles redactados/acotados.

Errores de JSON-RPC, negociación o schema MCP se devuelven como errores del protocolo, no como éxito parcial de dominio.

## Consecuencias

No se ocultan warnings de Inkscape ni se devuelve stderr completo. Un lote `all_or_nothing` falla sin publicar artefactos finales si cualquier variante falla.
