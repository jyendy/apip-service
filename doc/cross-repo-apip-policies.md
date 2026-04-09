# Repositorio `apip-policies` (roles y políticas IAM centralizadas)

Se creará un repositorio hermano **`apip-policies`** para **definir y centralizar** los roles y políticas de AWS reutilizables entre:

| Proyecto | Uso típico de IAM |
|----------|-------------------|
| **apip-front** | Despliegue estático (S3, CloudFront, invalidación), CI con **OIDC** a AWS, lectura de parámetros. |
| **apip-service** | Lambdas (ejecución, API Gateway), DynamoDB, EventBridge, S3 (imports), CI/CD de infra. |

## Relación con los stacks de `apip-service`

La infraestructura en **`infra/cloudformation/stacks/`** está **segmentada** (datos, mensajería, artefactos, API) para:

- Desplegar en **olas** paralelas donde no haya dependencias.
- Evitar que un stack falle por recursos que otro stack aún no ha exportado.

El **rol de ejecución de Lambda** vive hoy en **`api-stack.yaml`**. Cuando exista **`apip-policies`**, podéis:

- Sustituir políticas inline por **managed policies** o **roles** exportados desde ese repo.
- Mantener **OIDC de GitHub** y límites por recurso/etiqueta en un solo lugar.

## Principios

- **Una sola fuente de verdad** para nombres de políticas, límites por entorno (`DEV` / `STG` / `PRD`) y asunción de roles OIDC de GitHub Actions.
- Los stacks de **apip-service** deben **importar** o **referenciar** ARNs exportados por CloudFormation desde `apip-policies`, o documentar los **nombres esperados** de roles para evitar duplicar JSON de políticas en cada repo.
- Convención de etiquetas y paths Parameter Store (`/apip/{stage}/...`).

Este archivo solo documenta el **acuerdo entre repos**; la implementación vive en **`apip-policies`**.
