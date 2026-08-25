# ADR-002: Arquitectura híbrida DOM SVG + Inkscape CLI/actions

## Estado

Aceptada el 2026-08-25.

## Contexto

Las operaciones estructurales SVG son más deterministas cuando se editan en un DOM seguro, mientras que render, algunas consultas visuales, booleanas y exportaciones necesitan Inkscape real.

## Decisión

- El dominio opera con contratos tipados y no conoce MCP ni argumentos CLI.
- Un DOM SVG seguro realiza estructura, atributos, estilos, metadata y formas básicas.
- Un adaptador de Inkscape realiza render, exportación, bounds visuales y acciones allowlisted.
- Una capa de orquestación elige backend, crea staging, verifica artefactos y normaliza diferencias por versión.
- No habrá herramienta pública para ejecutar comandos, acciones o argumentos crudos.

## Consecuencias

La cobertura se amplía por capabilities probadas. Una acción que precise GUI, extensión o semántica no demostrada devuelve un error recuperable en vez de simular éxito.
