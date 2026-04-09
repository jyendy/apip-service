# apip-service

Backend de **APIP** (Asset Performance Intelligence Platform): API HTTP (API Gateway + Lambda TypeScript), persistencia, autenticación y procesamiento asíncrono según el diseño acordado.

## Estructura

| Directorio | Contenido |
|------------|-----------|
| `infra/` | CloudFormation **por stacks** (`data`, `messaging`, `artifacts`, `api`); ver `infra/cloudformation/README.md`. Roles OIDC/políticas compartidas: repo **`apip-policies`**. |
| `src/` | Código de las funciones Lambda y librerías compartidas. |
| `doc/` | Documentación del servicio (decisiones, patrones de acceso DynamoDB, OpenAPI). |

## Especificación de producto y API

La referencia principal para implementación está en el repositorio **apip-front**:

- [`doc/prompt-backend-consolidado.md`](../apip-front/doc/prompt-backend-consolidado.md)

Mantén ese documento como fuente de verdad; aquí en `doc/` se añaden detalles **específicos del despliegue y del código** de este repo.

## Entornos

Tres cuentas AWS: **DEV**, **STG**, **PRD** (ver prompt consolidado y `doc/` local).

## Despliegue de infraestructura

1. **Ola 1 (paralelo):** `data-stack`, `messaging-stack`, `artifacts-stack`.
2. **Ola 2:** `api-stack` (importa exports de datos y mensajería; subir antes el ZIP de Lambda al bucket indicado).

Detalle, diagrama y nombres de **exports**: [`infra/cloudformation/README.md`](infra/cloudformation/README.md). Workflow opcional: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (`workflow_dispatch`).
