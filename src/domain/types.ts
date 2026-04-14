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

/** Hechos de ingreso; `category` libre (p. ej. tms, monthly). */
export type RevenueFact = {
  id: string
  tenantId: string
  assetId: string
  date: string
  amount: number
  category: string
  source: FactSource
  createdAt: string
  sourceRef?: { kind: 'tms_trip' | 'tms_order'; id: string }
}

/** Código del catálogo (`cost-categories.ts`); el motor agrupa vía `costCategoryToBucket`. */
export type CostFact = {
  id: string
  tenantId: string
  assetId: string
  date: string
  amount: number
  category: string
  source: FactSource
  createdAt: string
  sourceRef?: { kind: 'tms_trip' | 'tms_order'; id: string }
}

export type InvestorRole = 'limited_partner' | 'general_partner' | 'advisor' | 'stakeholder' | 'other'

/** Aporte o devolución de fondos al inversionista (inmutable, auditado). Montos en moneda del portfolio. */
export type InvestorLedgerEntryType = 'contribution' | 'distribution'

export type InvestorLedgerEntry = {
  id: string
  tenantId: string
  investorId: string
  type: InvestorLedgerEntryType
  /** Siempre positivo; contribution aumenta saldo en manos del fondo, distribution lo reduce. */
  amount: number
  occurredAt: string
  note?: string
  createdAt: string
}

/** Asignación de capital del LP a un proyecto (no granular por activo en MVP). */
export type ProjectInvestorAllocation = {
  tenantId: string
  projectId: string
  investorId: string
  amount: number
  createdAt: string
  updatedAt: string
}

/** Parte interesada (LP, GP, asesor) vinculada a una o más carteras para vistas de exposición. */
export type Investor = {
  id: string
  tenantId: string
  name: string
  role: InvestorRole
  email?: string
  /** Carteras con las que se asocia el inversionista (exposición agregada). */
  portfolioIds: string[]
  /** Compromiso de capital declarado (opcional; no validado contra activos). */
  committedCapital?: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export type ImportJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL'

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

/** TMS — orden de transporte (operacional; no métricas financieras). */
export type TransportOrderStatus = 'CREATED' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED'

/** Catálogo TMS — cliente (tenant-scoped en apip-core). */
export type TmsCustomer = {
  id: string
  tenantId: string
  name: string
  taxId?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

/** Catálogo TMS — localidad (origen/destino). */
export type TmsLocality = {
  id: string
  tenantId: string
  name: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  latitude?: number
  longitude?: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export type TmsTransportProvider = {
  id: string
  tenantId: string
  name: string
  isOwnFleet: boolean
  taxId?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export type TmsDriver = {
  id: string
  tenantId: string
  providerId: string
  name: string
  licenseNumber?: string
  phone?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export type TmsVehicleUnit = {
  id: string
  tenantId: string
  providerId: string
  code: string
  plate?: string
  capacityPackages?: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export type TmsRate = {
  id: string
  tenantId: string
  customerId: string
  originLocalityId: string
  destinationLocalityId: string
  providerId: string
  buyPrice: number
  sellPrice: number
  currency: string
  validFrom: string
  validTo?: string
  isActive: boolean
  notes?: string
  createdAt: string
  updatedAt: string
}

export type TmsRouteStopType = 'PICKUP' | 'DROPOFF'

export type TmsRouteStop = {
  id: string
  sequence: number
  localityId: string
  type: TmsRouteStopType
  notes?: string
}

export type TmsRoute = {
  id: string
  tenantId: string
  name: string
  originLocalityId: string
  destinationLocalityId: string
  stops: TmsRouteStop[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export type TransportOrder = {
  id: string
  tenantId: string
  /** Ausente en órdenes legado (texto libre previo a catálogos). */
  customerId?: string
  originLocalityId?: string
  destinationLocalityId?: string
  /** Denormalizado al guardar desde catálogo (listados sin joins). */
  customerName: string
  originLabel: string
  destinationLabel: string
  packageCount: number
  providerId: string
  providerName: string
  rateId: string
  sellPrice: number
  buyPrice: number
  currency: string
  marginAmount: number
  cargoDescription: string
  scheduledDate: string
  status: TransportOrderStatus
  createdAt: string
  updatedAt: string
}

/** TMS — viaje de ejecución vinculado a activo transport. */
export type TransportTripStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'

export type TransportTrip = {
  id: string
  tenantId: string
  assetId: string
  orderIds: string[]
  routeId?: string
  providerId: string
  providerName: string
  driverId: string
  driverName: string
  vehicleUnitId: string
  vehicleUnitCode: string
  startDate?: string
  endDate?: string
  distanceKm?: number
  status: TransportTripStatus
  createdAt: string
  updatedAt: string
}

/** Rol de acceso por tenant; `permissionKeys` alineados al catálogo en `permission-keys.ts`. */
export type AccessRole = {
  id: string
  tenantId: string
  name: string
  description?: string
  permissionKeys: string[]
  createdAt: string
  updatedAt: string
}

/** Perfil de usuario enlazado a Cognito (`cognitoSub`); datos personales y asignación de roles. */
export type TenantUserProfile = {
  tenantId: string
  cognitoSub: string
  email?: string
  displayName?: string
  photoUrl?: string
  preferences?: Record<string, unknown>
  /** IDs de roles definidos en `AccessRole` para este tenant. */
  roleIds: string[]
  createdAt: string
  updatedAt: string
}
