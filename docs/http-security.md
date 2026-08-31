# Seguridad del transporte HTTP experimental

HTTP es una superficie P2, opt-in y exclusivamente local. No reemplaza el
transporte predeterminado por `stdio` ni convierte al servidor en un servicio
remoto o multiusuario de red.

## Límite y amenazas tratadas

El listener acepta sólo `127.0.0.1` y `/mcp`. Antes de construir un servidor
MCP por request valida `Host` y `Origin`, limita cuerpo, tiempo y tasa, y exige
un bearer válido. Por ello rechaza DNS rebinding, requests de otro origen,
headers Host falsificados, payloads demasiado grandes y fuerza bruta local
simple sin despachar herramientas ni tocar documentos.

El bearer procede exclusivamente de una fuente de configuración del operador:

- `INKSCAPE_MCP_HTTP_TOKEN` acepta un único token base64url de 32 a 256
  caracteres.
- `INKSCAPE_MCP_HTTP_TOKENS_FILE` es una ruta de configuración interna a un
  JSON estricto que mapea hasta 32 IDs de principal (`A-Za-z0-9._-`) a tokens
  base64url. Nunca es una ruta aportada por una tool MCP ni se incluye en
  resultados, logs o diagnósticos.

Para rotar sin reiniciar, escribe el JSON nuevo en un archivo temporal bajo el
mismo directorio protegido por ACL y reemplaza el archivo configurado de forma
atómica. El proveedor lo relee en cada request; si el reemplazo queda ilegible
o inválido, HTTP falla cerrado con `503` y no despacha MCP. Una rotación elimina
inmediatamente los tokens que ya no estén en el archivo. Mantén archivo y
directorio privados para el usuario que ejecuta el proceso.

La comparación se hace sobre SHA-256 de longitud fija mediante comparación de
tiempo constante. El valor del token sólo vive durante la autenticación y no
entra a la configuración serializable, los argumentos de herramientas, stdout
ni los eventos.

## Ownership y recursos

Cada principal autenticado recibe un identificador interno derivado por hash.
El owner efectivo se compone de ese identificador y el `workspaceId` opaco, por
lo que dos principals que conozcan el mismo workspace no comparten artifacts,
snapshots, planes de exportación, jobs, documentos-resource ni manifests. Las
URI opacas de recursos se vuelven además capabilities ligadas al principal en
HTTP; no basta conocer su ID aleatorio. En stdio se conserva el contrato
owner-bound por workspace de la versión 1.0.

## Observabilidad segura

Cada request HTTP genera una traza OpenTelemetry local `mcp.http.request`. El
exportador estructurado a stderr permite sólo `event`, `status`, `durationMs` y
el ID hash del principal autenticado. No admite etiquetas de URL, headers,
token, cuerpo, rutas, SVG ni contenido de documentos. Los eventos de listener,
rechazo y error siguen el mismo límite.

## Límites que permanecen

HTTP no soporta bind remoto, proxy, túnel, OAuth ni autorización por ACL de
filesystem. Todos los workspaces configurados siguen siendo locales y los
parsers nativos no están aislados por un sandbox de SO. No habilites HTTP para
documentos hostiles ni como frontera de seguridad de varios usuarios hasta
completar sandbox, matriz de plataformas y conformance HTTP moderno.
