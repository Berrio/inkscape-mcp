# inkscape-mcp

Servidor MCP local para controlar Inkscape de forma headless y segura. La prioridad inicial es controlar tamaños de documento, unidades, `viewBox`, páginas y exportaciones fiables a PNG, PDF y SVG; después se ampliará a edición vectorial de alto nivel.

> Estado: pre-alpha. El binario solo muestra ayuda y versión; todavía no hay un servidor MCP funcional ni paquete publicado.

## Alcance previsto

- Descubrir una instalación local de Inkscape, incluida la distribución MSIX de Windows.
- Crear, inspeccionar y redimensionar documentos SVG/Inkscape.
- Exportar PNG, PDF y SVG con validación de tamaño, páginas, estructura y hashes.
- Exponer herramientas MCP semánticas para elementos, capas, estilos, paths, texto, imágenes y preflight.
- Restringir acceso a workspaces autorizados y evitar comandos o argumentos arbitrarios.

## Desarrollo

La implementación sigue el [plan maestro](./PLAN_IMPLEMENTACION.md) y las [instrucciones para agentes](./AGENTS.md). Se ejecuta un solo work package por sesión, con pruebas y evidencia antes de cerrar cada tarea.

Requisitos planeados:

- Node.js 24 LTS.
- Inkscape 1.4.4 como baseline inicial en Windows.

## Estado y seguridad

El servidor aún no procesa archivos. Cuando exista, la versión 1.0 declarará de forma explícita sus límites de seguridad: protegerá rutas, XML, argumentos, revisiones y artefactos, pero no afirmará aislar vulnerabilidades desconocidas de parsers nativos sin un sandbox reforzado.

## Licencia

[MIT](./LICENSE) © 2026 Berrio.
