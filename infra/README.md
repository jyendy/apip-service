# Infraestructura

Plantillas **CloudFormation** con **nombres de recursos fijos por cuenta** (una cuenta AWS por entorno: dev, stg, prd).

## Segmentación

Ver **`cloudformation/README.md`**: stacks separados (`data`, `messaging`, `artifacts`, `api`) para despliegues **paralelos** donde aplica y dependencias explícitas vía **exports/imports**.

Resumen:

| Stack | Contenido | Paralelo con |
|-------|-----------|--------------|
| `data-stack` | DynamoDB core + auditoría | messaging, artifacts |
| `messaging-stack` | EventBridge bus de dominio | data, artifacts |
| `artifacts-stack` | S3 para ZIPs de Lambda | data, messaging |
| `api-stack` | IAM rol Lambda, Lambda, API HTTP | **después** de data + messaging |

## IAM centralizado

Roles de **CI (OIDC)** y políticas compartidas entre **apip-front** y **apip-service** deben definirse en el repo **`apip-policies`**. Las plantillas aquí incluyen el **rol de ejecución de Lambda**; al centralizar políticas, sustituir o adjuntar ARNs exportados desde `apip-policies` sin cambiar contratos de datos.

## Parameter Store

Convención sugerida: `/apip/...` por cuenta (ver `doc/` en la raíz del servicio).
