# Financial engine — decisiones de producto (fuente de verdad)

Documento de referencia alineado al motor implementado en `src/services/metrics.ts` y `src/financial/engine.ts`.

## Final decision (authoritative)

**Financial Engine & Metrics Source of Truth**

The platform implements a **hybrid financial model** with a **single source of truth in the backend**.

### Core principle

All financial metrics (ROI, IRR, cash flow, etc.) must be:

- **Calculated exclusively in the backend**
- **Never calculated in the frontend**

The frontend is strictly a **presentation layer**.

### Data model approach

Each asset supports two layers:

1. **Simulation layer (financial model)** — estimated revenue, estimated costs, investment assumptions (`financialModel` on the asset).
2. **Operational layer (actual data)** — real revenue and costs per period (`RevenueFact` / `CostFact`).

### Calculation logic

The backend implements a **hybrid engine**:

- If no actual data exists → **Simulation**
- If full actual data exists for the computed horizon → **Actual**
- If partial actual data exists → **Hybrid (actual + projected)**

### API contract (mandatory)

Metric responses include calculated fields (ROI, IRR, revenue totals, costs, net profit) and:

- `dataMode`: `SIMULATION` | `ACTUAL` | `HYBRID`
- `coverage`: `actualMonths`, `projectedMonths`, `totalMonths`
- Cash flow time series with per-period `mode`: `ACTUAL` | `PROJECTED`

### Non-negotiable rules

- Do **not** calculate financial metrics in the frontend
- Do **not** duplicate financial logic across frontend and backend
- Do **not** allow manual input of ROI or IRR
- **Always** derive headline metrics from the unified monthly cash flow series

### Product behavior

- Works without operational integrations (simulation-first, when `financialModel` is present).
- Improves automatically when real data is available.
- Provides consistent financial results across all interfaces.

## Agregación por grupo (proyecto / portfolio / tipo)

Para vistas agregadas, el sistema aplica esta regla obligatoria:

- No promediar ROI/IRR/NPV entre assets.
- Alinear primero las series por mes calendario global.
- Sumar cashflows netos mensuales del grupo.
- Recalcular ROI/IRR/NPV/Payback sobre la serie agregada.

Esto aplica tanto para `asset view` (t0 = suma de `initialInvestment`) como para `equity view` (t0 = suma de `downPayment` de assets con financiamiento).

### Closing statement

This platform is a **financial intelligence system**, not an operational tool. The backend defines financial truth; the frontend only visualizes it.

---

## Notas de implementación (horizonte mensual)

- El mes 0 es el mes de `acquisitionDate` (UTC, clave `YYYY-MM`).
- `totalMonths = max(financialModel.durationMonths, meses desde adquisición hasta el último mes con hechos)`.
- Meses **sin** hechos y **con** modelo usan proyección con `estimatedMonthlyRevenue` / `estimatedMonthlyCost` y tasas de crecimiento opcionales (`revenueGrowthRate`, `costGrowthRate`, interpretadas como % anual compuesto vía \(r_{mensual} = r_{anual}/100/12\) en el exponente, igual que `POST /v1/simulations`).
- Sin modelo y sin hechos en un mes intermedio: ese mes se trata como flujo **proyectado** en cero (`PROJECTED`), manteniendo continuidad de la serie para IRR/NPV.
