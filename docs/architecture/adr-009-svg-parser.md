# ADR-009: Parser SVG seguro

Se evaluaron `fast-xml-parser` 5.11.0 (MIT, rápido pero orientado a objeto y con menor fidelidad de comments/namespaces para round-trip) y `@xmldom/xmldom` 0.9.12 (MIT, DOM/XMLSerializer y preservación adecuada de SVG/defs/comments). Se elige `@xmldom/xmldom`.

Antes de parsear se rechazan DTD, entidades y CDATA. El parser recibe límites de bytes y elementos. La sanitización quita scripts y eventos siempre; en `strict` también elimina `foreignObject` y toda referencia que no sea fragmento local. El cliente nunca puede seleccionar una confianza superior al ceiling de configuración, que se conectará en la capa de servicios.
