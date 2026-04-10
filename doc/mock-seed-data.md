# Mock seed data para carga inicial (DB)

Objetivo: tener un set consistente de datos mock para poblar la base cuando todo el flujo API quede integrado de punta a punta.

## Alcance

- 2 tenants
- 2 portfolios (1 por tenant)
- 2 projects (1 por tenant)
- 4 assets (2 por tenant)
- hechos de cash-flow para iniciar métricas híbridas

## Orden recomendado de carga

1. Crear usuario root (`apip-platform-admin`) y obtener JWT.
2. `POST /v1/admin/tenants` (x2).
3. Crear usuarios tenant en Cognito y asignar `custom:tenantId`.
4. Con JWT tenant: `POST /v1/portfolios`, `POST /v1/projects`, `POST /v1/assets`.
5. `PUT /v1/assets/{assetId}/cash-flows` para meses iniciales.

## 1) Tenants (root)

```json
[
  { "id": "tenant-acme", "name": "Acme Capital", "type": "fund" },
  { "id": "tenant-globex", "name": "Globex Family Office", "type": "family_office" }
]
```

## 2) Portfolios (por tenant)

Tenant `tenant-acme`:

```json
{
  "name": "Portafolio Logistica MX",
  "strategy": "Yield + eficiencia operativa",
  "baseCurrency": "USD"
}
```

Tenant `tenant-globex`:

```json
{
  "name": "Portafolio Inmobiliario Norte",
  "strategy": "Renta estable",
  "baseCurrency": "USD"
}
```

## 3) Projects (por tenant)

> Reemplazar `portfolioId` con el valor real retornado por el POST de portfolios.

Tenant `tenant-acme`:

```json
{
  "portfolioId": "<acme-portfolio-id>",
  "name": "Expansion Fleet 2026",
  "description": "Renovacion y crecimiento de unidades de transporte",
  "status": "active",
  "budget": 4500000,
  "startDate": "2026-01-01T00:00:00.000Z"
}
```

Tenant `tenant-globex`:

```json
{
  "portfolioId": "<globex-portfolio-id>",
  "name": "Retail + Oficinas Norte",
  "description": "Consolidacion de activos comerciales",
  "status": "active",
  "budget": 8200000,
  "startDate": "2026-01-01T00:00:00.000Z"
}
```

## 4) Assets (POST /v1/assets)

> Reemplazar `portfolioId` y `projectId` por IDs reales del tenant.

### tenant-acme (transport)

```json
[
  {
    "portfolioId": "<acme-portfolio-id>",
    "projectId": "<acme-project-id>",
    "name": "Unidad Edomex 101",
    "type": "transport",
    "acquisitionDate": "2026-01-15T00:00:00.000Z",
    "initialInvestment": 1100000,
    "currency": "USD",
    "status": "active",
    "metadata": { "operationalModule": "tms", "plate": "EDX-101" },
    "financialModel": {
      "estimatedMonthlyRevenue": 56500,
      "estimatedMonthlyCost": 36900,
      "durationMonths": 36,
      "revenueGrowthRate": 0.02,
      "costGrowthRate": 0.01
    }
  },
  {
    "portfolioId": "<acme-portfolio-id>",
    "projectId": "<acme-project-id>",
    "name": "Unidad CDMX 106",
    "type": "transport",
    "acquisitionDate": "2026-02-01T00:00:00.000Z",
    "initialInvestment": 1120000,
    "currency": "USD",
    "status": "active",
    "metadata": { "operationalModule": "tms", "plate": "CDX-106" },
    "financialModel": {
      "estimatedMonthlyRevenue": 58000,
      "estimatedMonthlyCost": 37400,
      "durationMonths": 36
    }
  }
]
```

### tenant-globex (real_estate)

```json
[
  {
    "portfolioId": "<globex-portfolio-id>",
    "projectId": "<globex-project-id>",
    "name": "Local Comercial Centro",
    "type": "real_estate",
    "acquisitionDate": "2026-01-10T00:00:00.000Z",
    "initialInvestment": 1200000,
    "currency": "USD",
    "status": "active",
    "metadata": { "operationalModule": "real-estate", "city": "CDMX" },
    "financialModel": {
      "estimatedMonthlyRevenue": 8500,
      "estimatedMonthlyCost": 2500,
      "durationMonths": 60
    }
  },
  {
    "portfolioId": "<globex-portfolio-id>",
    "projectId": "<globex-project-id>",
    "name": "Oficina Zona Norte",
    "type": "real_estate",
    "acquisitionDate": "2026-01-20T00:00:00.000Z",
    "initialInvestment": 850000,
    "currency": "USD",
    "status": "active",
    "metadata": { "operationalModule": "real-estate", "city": "CDMX" },
    "financialModel": {
      "estimatedMonthlyRevenue": 6200,
      "estimatedMonthlyCost": 1550,
      "durationMonths": 60
    }
  }
]
```

## 5) Cash-flows iniciales (PUT /v1/assets/{assetId}/cash-flows)

Aplicar al menos a 1 asset por tenant para validar modo híbrido:

```json
{
  "periods": [
    { "period": "2026-01", "revenue": 57000, "cost": 36000, "source": "tms" },
    { "period": "2026-02", "revenue": 56200, "cost": 37100, "source": "tms" },
    { "period": "2026-03", "revenue": 58900, "cost": 37950, "source": "tms" }
  ]
}
```

y para real estate:

```json
{
  "periods": [
    { "period": "2026-01", "revenue": 8500, "cost": 2000, "source": "erp" },
    { "period": "2026-02", "revenue": 8500, "cost": 1950, "source": "erp" },
    { "period": "2026-03", "revenue": 8500, "cost": 2100, "source": "erp" }
  ]
}
```

## Reglas de edición de assets (PATCH)

- Permitido: `name`, `status`, `metadata`, `financialModel` (y otros campos no estructurales).
- **Bloqueado con 409 `MODEL_LOCKED`** si ya existen hechos (`RevenueFact`/`CostFact`) y se intenta cambiar alguno de:
  - `type`
  - `acquisitionDate`
  - `initialInvestment`
  - `currency`

Esto protege la coherencia histórica del modelo financiero.
