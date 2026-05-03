# Parámetros de despliegue (pipeline)

## `deploy/env/aws-apip-{dev|stg|prd}.env`

Archivo **por entorno** con variables en formato `KEY=value` (comentarios con `#`).

Hoy solo se usa **`AWS_ACCOUNT_ID`** para el ARN del rol OIDC (`AWSAPIPDeployExecutionRole`). Puedes añadir más claves más adelante (por ejemplo nombres de bucket fijos) y leerlas en el workflow con el mismo `source`.

**No** pongas secretos en estos archivos si el repo es público; el ID de cuenta no es secreto pero delimita la superficie.

Actualiza **`aws-apip-stg.env`** y **`aws-apip-prd.env`** con los IDs reales antes de usar las ramas `staging` y `main`.
