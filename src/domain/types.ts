/** Entidades de dominio APIP (alineadas al prompt consolidado). */

export type TenantType = 'fund' | 'company' | 'family_office' | 'other'

export type Tenant = {
  id: string
  name: string
  type: TenantType
  createdAt: string
}

export type Portfolio = {
  id: string
  tenantId: string
  name: string
  strategy?: string
  baseCurrency?: string
  createdAt: string
  updatedAt: string
}

export type ProjectStatus = 'planning' | 'active' | 'completed' | 'on_hold'

export type Project = {
  id: string
  tenantId: string
  portfolioId: string
  name: string
  description?: string
  status: ProjectStatus
  budget?: number
  startDate: string
  endDate?: string
  createdAt: string
  updatedAt: string
}

export type AssetType = 'transport' | 'real_estate' | 'machinery' | 'energy' | 'other'

export type AssetStatus = 'active' | 'inactive' | 'maintenance' | 'sold'

/** Modelo financiero estimado (simulación); los hechos operativos van en RevenueFact/CostFact. */
export type AssetFinancialModel = {
  estimatedMonthlyRevenue: number
  estimatedMonthlyCost: number
  durationMonths: number
  revenueGrowthRate?: number
  costGrowthRate?: number
}

export type Asset = {
  id: string
  tenantId: string
  portfolioId: string
  projectId: string
  name: string
  type: AssetType
  acquisitionDate: string
  initialInvestment: number
  currency: string
  status: AssetStatus
  metadata?: Record<string, unknown>
  /** Supuestos de simulación cuando aún no hay o hay pocos hechos reales. */
  financialModel?: AssetFinancialModel
  createdAt: string
  updatedAt: string
}

export type CapitalEventType = 'investment' | 'reinvestment' | 'distribution' | 'exit' | 'other'

export type CapitalEvent = {
  id: string
  tenantId: string
  assetId: string
  type: CapitalEventType
  amount: number
  date: string
  note?: string
  createdAt: string
}

export type FactSource = 'manual' | 'import' | 'api'

export type RevenueFact = {
  id: string
  tenantId: string
  assetId: string
  date: string
  amount: number
  category: string
  source: FactSource
  createdAt: string
}

export type CostCategory = 'direct' | 'operational' | 'maintenance' | 'depreciation' | 'other'

export type CostFact = {
  id: string
  tenantId: string
  assetId: string
  date: string
  amount: number
  category: CostCategory
  source: FactSource
  createdAt: string
}

export type ImportJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export type ImportJob = {
  id: string
  tenantId: string
  status: ImportJobStatus
  fileKey?: string
  templateVersion?: string
  totalRows?: number
  okRows?: number
  errorRows?: number
  errorReportKey?: string
  createdAt: string
  updatedAt: string
}

export type Simulation = {
  id: string
  tenantId: string
  name?: string
  assetType: AssetType
  initialCapital: number
  expectedMonthlyRevenue: number
  expectedOperatingCost: number
  growthRatePercent?: number
  durationMonths: number
  discountRateAnnual?: number
  projectedROI: number
  projectedIRR: number
  projectedNPV: number
  breakEvenMonth: number
  calculationVersion: string
  createdAt: string
  updatedAt: string
}

export type InsightSeverity = 'info' | 'warning' | 'critical'

export type Insight = {
  id: string
  tenantId: string
  scope: 'tenant' | 'portfolio' | 'project' | 'asset'
  severity: InsightSeverity
  title: string
  body: string
  ruleId: string
  assetIds?: string[]
  projectIds?: string[]
  generatedAt: string
}

export type CashFlowPeriodMode = 'ACTUAL' | 'PROJECTED'

export type CashFlowPoint = {
  date: string
  revenue: number
  costs: number
  netCashFlow: number
  cumulativeCashFlow: number
  /** Origen del mes respecto al motor híbrido. */
  mode: CashFlowPeriodMode
}

export type MetricsDataMode = 'SIMULATION' | 'ACTUAL' | 'HYBRID'

export type MetricsCoverage = {
  actualMonths: number
  projectedMonths: number
  totalMonths: number
}

export type AssetMetricsComputed = {
  assetId: string
  initialInvestment: number
  accumulatedRevenue: number
  /** Suma de costos mensuales de la serie (actual + proyectado). */
  totalCosts: number
  /** Costes operativos + mantenimiento + depreciación (agregado; compatible con vistas previas). */
  operatingCosts: number
  ebitda: number
  netProfit: number
  roi: number
  irr: number
  paybackPeriodMonths: number
  npv: number
  cashFlow: CashFlowPoint[]
  dataMode: MetricsDataMode
  coverage: MetricsCoverage
  calculationVersion: string
}
