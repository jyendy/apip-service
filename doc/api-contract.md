# Contrato API APIP (v1)

Este documento define el contrato REST de **apip-service**: multi-tenant por **JWT** (claim `custom:tenantId` o equivalente), sin prefijo `/v1/tenants/{tenantId}` en la URL salvo extensiones futuras de administración global.

## Autenticación y tenant

- **Authorization**: `Bearer <access_token>` (Cognito).
- **Tenant**: se resuelve desde el token en Lambda (`resolveRequestContext`). No se envía `tenantId` en path para recursos de negocio.
- **Desarrollo**: si está habilitado `ALLOW_DEV_TENANT_HEADER`, cabecera `X-Tenant-Id` (solo no productivo).

### Administración de plataforma (root)

Rutas bajo `/v1/admin/*` requieren el **mismo JWT**, pero el usuario debe ser administrador de plataforma:

- Grupo Cognito cuyo nombre está en **`PLATFORM_ADMIN_GROUP`**: uno o varios nombres separados por comas (por defecto en código `apip-platform-admin,admin`; en despliegue suele fijarse vía CloudFormation), **o**
- Claim `custom:platformAdmin` = `true`.

Endpoints:

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/v1/admin/tenants` | Lista tenants (registro `PLATFORM#REGISTRY`) |
| POST | `/v1/admin/tenants` | Crea tenant (`name`, `type`, `id` opcional) |
| GET | `/v1/admin/tenants/{tenantId}` | Detalle |
| PATCH | `/v1/admin/tenants/{tenantId}` | Actualiza nombre/tipo |

Los usuarios **root** no necesitan `custom:tenantId` en el token para estas rutas; el resto de la API sí exige tenant salvo cabecera de dev.

### CORS y OPTIONS

- **Navegadores** (web, muchas apps híbridas): envían **preflight** `OPTIONS` para llamadas cross-origin; por eso existe la ruta explícita **`OPTIONS /v1/{proxy+}`** sin JWT y la **`CorsConfiguration`** en la HTTP API.
- **Apps nativas** (iOS/Android) y muchos **backends** suelen llamar a la API **sin** CORS; no dependen de `OPTIONS`, pero tener OPTIONS explícito no los perjudica.
- **Integraciones de terceros** en servidor: igualmente sin CORS; autenticación Bearer habitual.

## Principios de datos financieros

- **Fuente de verdad**: ROI, IRR, flujos y agregados se calculan **solo en el backend** a partir de la **serie mensual unificada** (simulación + hechos). El cliente **no** debe recalcular métricas financieras ni enviar ROI/IRR manuales.
- **Capas por activo**: (1) **simulación** vía `financialModel` (ingresos/costos/inversión estimados); (2) **operativo** vía `RevenueFact` / `CostFact` (datos reales por periodo).
- **Motor híbrido**: sin hechos → modo `SIMULATION`; solo hechos en el horizonte → `ACTUAL`; mezcla → `HYBRID`. Detalle de producto: [`financial-engine.md`](./financial-engine.md).

### Respuesta de métricas (`GET .../metrics` y payloads que incluyen `metrics`)

Incluye al menos: `accumulatedRevenue`, `totalCosts`, `ebitda`, `netProfit`, `roi`, `irr`, `npv`, `paybackPeriodMonths`, `cashFlow[]`, `dataMode` (`SIMULATION` | `ACTUAL` | `HYBRID`), `coverage` (`actualMonths`, `projectedMonths`, `totalMonths`), `calculationVersion`. Cada punto de `cashFlow` incluye `mode` por mes: `ACTUAL` | `PROJECTED`.

## Convenciones

- Base path: `/v1`.
- JSON `application/json`.
- Errores: `{ "error": { "code": string, "message": string, "details?": unknown } }` (alineado a `jsonError` en Lambda).

## Recursos

### Salud

| Método | Ruta        | Auth |
|--------|-------------|------|
| GET    | `/health`   | No   |

### Portfolios

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/v1/portfolios` | Lista |
| POST   | `/v1/portfolios` | Crea |
| GET    | `/v1/portfolios/{portfolioId}` | Detalle |
| PATCH  | `/v1/portfolios/{portfolioId}` | Actualiza |
| GET    | `/v1/portfolios/{portfolioId}/metrics` | Métricas agregadas por activos |
| GET    | `/v1/portfolios/{portfolioId}/cashflow` | Series por activo |
| GET    | `/v1/portfolios/{portfolioId}/performance` | KPIs agregados |

**POST `/v1/portfolios`** — cuerpo JSON (validación Zod `createPortfolioBody` en `src/domain/schemas.ts`):

| Campo | Tipo | Obligatorio | Reglas |
|-------|------|-------------|--------|
| `name` | string | Sí | Mínimo 1 carácter. |
| `strategy` | string | No | Texto libre (estrategia o descripción corta). |
| `baseCurrency` | string | No | Si se envía, **exactamente 3 caracteres** (p. ej. código ISO 4217 `USD`, `EUR`). Omitir o no enviar el campo si no aplica. |

Respuesta **201**: objeto `Portfolio` creado (`id` generado en servidor, `tenantId` del JWT, `createdAt` / `updatedAt` en ISO 8601).

### Projects

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/v1/projects` | Lista (`?portfolioId=`) |
| POST   | `/v1/projects` | Crea |
| GET    | `/v1/projects/{projectId}` | Detalle |
| PATCH  | `/v1/projects/{projectId}` | Actualiza |
| GET    | `/v1/projects/{projectId}/metrics` | Métricas por activos del proyecto |
| GET    | `/v1/projects/{projectId}/cashflow` | Series por activo |

### Assets

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/v1/assets` | Lista (`projectId`, `portfolioId`, `type`) |
| POST   | `/v1/assets` | Crea (incluye `financialModel` opcional) |
| GET    | `/v1/assets/{assetId}` | Detalle |
| PATCH  | `/v1/assets/{assetId}` | Actualiza |
| DELETE | `/v1/assets/{assetId}` | Elimina (y hechos asociados) |
| GET    | `/v1/assets/{assetId}/metrics` | Métricas calculadas |
| GET    | `/v1/assets/{assetId}/cashflow` | Serie agregada (motor híbrido; ver `metrics`) |
| PUT    | `/v1/assets/{assetId}/cash-flows` | Reemplaza / carga hechos mensuales (`period` YYYY-MM) |
| GET    | `/v1/assets/{assetId}/structure` | Estructura financiera estandarizada |

**Body POST/PATCH asset** (campos principales): ver `openapi.yaml` y esquema Zod `createAssetBody` / `patchAssetBody`.

**Tipos de activo** (`type`): `transport`, `real_estate`, `flip`, `machinery`, `energy`, `other`. El tipo `flip` habilita el módulo operativo Flipping (Fix & Flip), independiente de `real_estate`.

**Regla de edición (modelo):** si el activo ya tiene hechos operativos (`RevenueFact`/`CostFact`), el backend bloquea cambios estructurales en `type`, `acquisitionDate`, `initialInvestment` y `currency` con `409 MODEL_LOCKED` para evitar romper series históricas.

**Body PUT `/cash-flows`**:

```json
{
  "periods": [
    { "period": "2025-01", "revenue": 52000, "cost": 35000, "source": "tms" }
  ]
}
```

### Flipping (módulo operativo Fix & Flip)

Solo aplica a activos con `type: flip`. No expone métricas financieras; las rehabilitaciones generan `CostFact` con `source: flipping`.

Documentación de producto (front): [`../../apip-front/doc/flipping-operativo-mvp.md`](../../apip-front/doc/flipping-operativo-mvp.md).

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/v1/flipping/projects/{assetId}` | Proyecto + activo (404 si no iniciado) |
| PUT | `/v1/flipping/projects/{assetId}` | Inicia o actualiza proyecto (seed DD en primera creación) |
| PATCH | `/v1/flipping/projects/{assetId}` | Actualiza fechas y dirección |
| PATCH | `/v1/flipping/projects/{assetId}/workflow` | Cambio de estado + comentario opcional |
| GET | `/v1/flipping/projects/{assetId}/due-diligence` | Lista checklist |
| POST | `/v1/flipping/projects/{assetId}/due-diligence` | Añade ítem al checklist |
| PATCH | `/v1/flipping/projects/{assetId}/due-diligence/{itemId}` | Marca completado / edita ítem |
| GET | `/v1/flipping/projects/{assetId}/rehabs` | Lista rehabilitaciones |
| POST | `/v1/flipping/projects/{assetId}/rehabs` | Alta rehab → crea `CostFact` si aplica |
| PATCH | `/v1/flipping/projects/{assetId}/rehabs/{rehabId}` | Edición rehab → sincroniza `CostFact` |

**Fotografías**: reutilizar `POST /v1/documents` con `entityType: flip_project`, `entityId: {assetId}`, campos opcionales `photoPhase` (`before` \| `during` \| `after`) y `rehabId`.

**Documentos del activo**: `GET/POST /v1/documents` con `entityType: asset` (igual que Real Estate).

### Dashboard e insights

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/v1/dashboard/executive` | KPIs y resumen de activos |
| GET    | `/v1/insights` | Reglas / insights |

### Importaciones y simulación

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST   | `/v1/imports/assets` | Crea job de importación (CSV/S3) |
| GET    | `/v1/imports/assets/{jobId}` | Estado del job |
| POST   | `/v1/simulations` | Simulación puntual (sin persistir activo) |
| GET    | `/v1/simulations` | Lista simulaciones guardadas |
| GET    | `/v1/simulations/{simulationId}` | Detalle de simulación |
| PATCH  | `/v1/simulations/{simulationId}` | Actualiza entradas y recalcula |
| DELETE | `/v1/simulations/{simulationId}` | Elimina simulación |

### Alerts (placeholder)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/v1/alerts` | Lista vacía / futuro |

## Tenants y usuarios

La administración de **Tenant** vía API está en **`/v1/admin/tenants`** (ver arriba). El mapeo de usuarios finales a Cognito (grupos, `custom:tenantId`) sigue siendo responsabilidad de **Cognito** / proceso de onboarding; este servicio persiste el registro de tenant en DynamoDB.

## OpenAPI

Definición máquina-legible: [`openapi.yaml`](./openapi.yaml).

## Gateway HTTP API

Las rutas anteriores están registradas **explícitamente** en API Gateway (no se usa un único `ANY /{proxy+}` para tráfico autenticado). CORS está configurado a nivel de API; existe además **`OPTIONS /v1/{proxy+}`** sin JWT para preflight. Las rutas de negocio y admin usan el autorizador JWT de Cognito.
