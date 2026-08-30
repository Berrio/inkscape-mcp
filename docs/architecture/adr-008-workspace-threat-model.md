# ADR-008: Threat model de workspace

## Decisión

### Revalidación de publicación

El servidor congela la identidad canónica de cada root al arrancar. Antes de crear un temporal y de cada `rename`, vuelve a resolver el parent vivo, verifica que sigue bajo uno de esos roots y rechaza un output final que sea symlink.

El cliente y cada documento se consideran no confiables. Solo se aceptan paths relativos bajo un root canónico configurado; los IDs de workspace son opacos. Entradas existentes se resuelven con `realpath`; outputs nuevos validan el parent canónico antes de construir el basename.

Se rechazan paths absolutos, UNC, drive-relative, NUL, ADS, segmentos `.`/`..` y escapes por symlink. Antes de cada futuro commit se revalidará el parent y la revisión. Las pruebas deterministas intercambian un directorio de destino por una junction de Windows después de staging, tanto para un output individual como para un lote: ambos abortan antes de cualquier `rename` hacia el destino externo.

### Límite explícito de Node estándar

Node sin un helper privilegiado no puede garantizar resistencia total contra un
atacante local concurrente que intercambie un symlink/junction/reparse point
después del último `realpath`/`lstat` y antes del `rename`. Las ACL de los roots
deben impedir ese actor. Resolverlo requeriría handles abiertos con semántica
`no-follow` y comprobación de identidad en un helper nativo o sandbox, trabajo
reservado para F12; el recheck actual es una mitigación, no una afirmación de
atomicidad frente a un escritor hostil.
