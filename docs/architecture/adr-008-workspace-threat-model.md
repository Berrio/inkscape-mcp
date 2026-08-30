# ADR-008: Threat model de workspace

## Decisión

### Revalidación de publicación

El servidor congela la identidad canónica de cada root al arrancar. Antes de crear un temporal y de cada `rename`, vuelve a resolver el parent vivo, verifica que sigue bajo uno de esos roots y rechaza un output final que sea symlink.

El cliente y cada documento se consideran no confiables. Solo se aceptan paths relativos bajo un root canónico configurado; los IDs de workspace son opacos. Entradas existentes se resuelven con `realpath`; outputs nuevos validan el parent canónico antes de construir el basename.

Se rechazan paths absolutos, UNC, drive-relative, NUL, ADS, segmentos `.`/`..` y escapes por symlink. Antes de cada futuro commit se revalidará el parent y la revisión. Node sin un helper privilegiado no puede garantizar resistencia total contra un atacante local concurrente que intercambie reparse points después de esa comprobación; las ACL de los roots deben impedir ese actor y el riesgo TOCTOU residual se declara explícitamente.
