# ADR-003: stdio predeterminado y HTTP opt-in

## Estado

Aceptada el 2026-08-25.

## Decisión

- El transporte predeterminado es MCP por stdio.
- stdout se reserva exclusivamente para JSON-RPC; diagnósticos y logs van a stderr.
- Streamable HTTP se implementa como expansión opt-in en F10, no como requisito de Windows/stdio 1.0.
- Si HTTP se activa, escucha en loopback, valida Host/Origin y exige bearer token siempre.

## Consecuencias

El primer release puede verificarse desde un proceso local sin exponer un puerto. HTTP no puede debilitar los contratos de ownership, roots, jobs o recursos.
