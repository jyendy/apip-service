/** Entidades de dominio APIP (alineadas al prompt consolidado). */

import type { UserAssignment } from './rbac'

export type TenantType = 'fund' | 'company' | 'family_office' | 'other'

export type TenantBillingStatus = 'trial' | 'active' | 'past_due' | 'canceled'
export type BillingPlanCode = 'starter' | 'pro' | 'enterprise'
export type BillingCycle = 'monthly' | 'annual'

/**
 * Estado de facturación por tenant para operación manual en Stripe (MVP).
 * `plan` se usa como bandera funcional en producto; ids Stripe son opcionales al inicio.
 */
export type TenantBilling = {
  status: TenantBillingStatus
  plan: `${BillingPlanCode}_${BillingCycle}`
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  updatedAt: string
}

/** Intención de compra/onboarding capturada desde website o sign-up antes de activar Stripe. */
export type BillingIntent = {
  id: string
  email: string
  name?: string
  planCode: BillingPlanCode
  billingCycle: BillingCycle
  status: 'new' | 'contacted' | 'approved' | 'rejected' | 'onboarded'
  notes?: string
  processedAt?: string
  processedBy?: string
  source?: string
  createdAt: string
  updatedAt: string
}

export type Tenant = {
  id: string
  name: string
  type: TenantType
  createdAt: string
  billing?: TenantBilling
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

export type ScenarioType = 'actual' | 'simulated'

/** Escenario de planeación o baseline actual por proyecto. */
export type Scenario = {
  id: string
  tenantId: string
  portfolioId: string
  projectId: string
  name: string
  type: ScenarioType
  createdAt: string
  updatedAt: string
  createdBy: string
}

export type AssetType = 'transport' | 'real_estate' | 'flip' | 'machinery' | 'energy' | 'other'

export type AssetStatus = 'active' | 'inactive' | 'maintenance' | 'sold'

/** Modelo financiero estimado (simulación); los hechos operativos van en RevenueFact/CostFact. */
export type AssetFinancialModel = {
  estimatedMonthlyRevenue: number
  estimatedMonthlyCost: number
  durationMonths: number
  revenueGrowthRate?: number
  costGrowthRate?: number
}

export type AssetRealEstateMetadata = {
  propertyType?: 'residential' | 'commercial' | 'short_stay'
  rentModel?: 'long_term' | 'short_term'
  units?: number
  notes?: string
}

export type Asset = {
  id: string
  tenantId: string
  portfolioId: string
  projectId: string
  /** Escenario al que pertenece el activo; ausente o null = vista actual (legacy o escenario actual canónico). */
  scenarioId?: string | null
  name: string
  type: AssetType
  acquisitionDate: string
  initialInvestment: number
  currency: string
  status: AssetStatus
  metadata?: Record<string, unknown> & AssetRealEstateMetadata
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

export type FactSource = 'manual' | 'import' | 'api' | 'real_estate' | 'flipping'

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
  sourceRef?: { kind: 'tms_trip' | 'tms_order' | 'flip_rehab'; id: string }
}

export type CapitalContribution = {
  id: string
  tenantId: string
  assetId: string
  amount: number
  date: string
  reason?: string
  investorId?: string
  createdAt: string
}

export type OccupancyRecord = {
  id: string
  tenantId: string
  assetId: string
  month: string
  occupiedDays: number
  availableDays: number
  createdAt: string
  updatedAt: string
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

/** Financiamiento opcional guardado con una simulación (misma lógica que activo / francés). */
export type SimulationFinancingStored = {
  principal: number
  annualInterestRate: number
  termMonths: number
  downPayment: number
  firstPaymentMonthOffset?: number
}

export type SimulationEquityMetrics = {
  projectedROI: number
  projectedIRR: number
  projectedNPV: number
  breakEvenMonth: number
}

export type Simulation = {
  id: string
  tenantId: string
  name?: string
  assetType: AssetType
  initialCapital: number
  expectedMonthlyRevenue: number
  expectedOperatingCost: number
  /** @deprecated Usar revenue/cost; si solo existe, proyección lo aplica a ambos. */
  growthRatePercent?: number
  revenueGrowthRatePercent?: number
  costGrowthRatePercent?: number
  durationMonths: number
  discountRateAnnual?: number
  financing?: SimulationFinancingStored | null
  equityMetrics?: SimulationEquityMetrics | null
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
  /** Cuota deuda (capital + interés); no es costo operativo. Solo vista equity / con financiamiento. */
  debtService?: number
  /** Flujo neto operativo (antes de deuda); en vista equity ayuda a comparar. */
  operatingNetCashFlow?: number
}

export type MetricsDataMode = 'SIMULATION' | 'ACTUAL' | 'HYBRID'

export type MetricsCoverage = {
  actualMonths: number
  projectedMonths: number
  totalMonths: number
}

/** Financiamiento asociado a un activo (MVP: máximo uno). Tasas en puntos % anuales. */
export type AssetFinancing = {
  id: string
  tenantId: string
  assetId: string
  principal: number
  annualInterestRate: number
  termMonths: number
  startDate: string
  amortizationType: 'french'
  downPayment: number
  createdAt: string
  updatedAt: string
}

/** Una fila del calendario de amortización (francés). `monthIndex` 1…n del préstamo. */
export type AmortizationPayment = {
  monthIndex: number
  payment: number
  principal: number
  interest: number
  remainingBalance: number
}

/** Severidad de un insight financiero (motor de reglas). */
export type FinancialInsightSeverity = 'critical' | 'warning' | 'info' | 'positive'

/** Salida del motor de insights financieros. */
export type FinancialInsight = {
  severity: FinancialInsightSeverity
  message: string
  recommendation?: string
  priority: number
}

/** Regla persistida evaluada con JEXL. */
export type InsightRule = {
  id: string
  name: string
  description?: string
  severity: FinancialInsightSeverity
  scope: 'asset' | 'equity' | 'both'
  condition: string
  message: string
  recommendation?: string
  priority: number
  isActive: boolean
  createdAt: string
}

/** Entrada al motor (variables en `condition`). */
export type FinancialInsightInput = {
  assetMetrics: {
    roi: number
    irr: number
    npv: number
    payback: number
  }
  equityMetrics?: {
    roi: number
    irr: number
    npv: number
    payback: number
  }
  avgOperatingCashFlow: number
  avgDebtService: number
  durationMonths: number
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

/** Respuesta enriquecida de métricas por activo (vista activo vs equity). */
export type AssetFinancialMetricsPackage = {
  assetId: string
  calculationVersion: string
  metrics: {
    asset: AssetMetricsComputed
    equity: AssetMetricsComputed | null
  }
  financing: {
    id: string
    principal: number
    annualInterestRate: number
    termMonths: number
    startDate: string
    amortizationType: 'french'
    downPayment: number
    monthlyPayment: number
    schedule: AmortizationPayment[]
  } | null
  /** Insights generados por reglas en base de datos (máx. 5 por vista). */
  insights?: {
    asset: FinancialInsight[]
    equity: FinancialInsight[] | null
  }
  projectionVsReality?: {
    projectedRevenue: number
    actualRevenue: number
    deltaRevenue: number
    projectedROI: number
    actualROI: number
  }
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
  /** Para flota propia: asset transport obligatorio (1:1). Para tercerizados: opcional. */
  assetId?: string
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
  /** IDs de roles definidos en `AccessRole` para este tenant (catálogo legacy). */
  roleIds: string[]
  /** Asignaciones RBAC (rol fijo + alcance). Si hay entradas, tienen prioridad sobre `roleIds` para autorización. */
  rbacAssignments?: UserAssignment[]
  createdAt: string
  updatedAt: string
}

/** Entidad “objetivo” del documento (transversal: activos, arrendamientos, DD, etc.). */
export type DocumentEntityType =
  | 'asset'
  | 'property'
  | 'lease'
  | 'flip_project'
  | 'due_diligence'

export type DocumentStatus = 'pending' | 'uploaded' | 'validated' | 'rejected'

export type DocumentPhotoPhase = 'before' | 'during' | 'after'

export type Document = {
  id: string
  tenantId: string
  portfolioId: string
  projectId: string
  entityType: DocumentEntityType
  entityId: string
  name: string
  fileName: string
  mimeType: string
  size: number
  s3Key: string
  status: DocumentStatus
  required: boolean
  requirementId?: string
  /** Clasificación fotográfica del módulo Flipping (entityType flip_project). */
  photoPhase?: DocumentPhotoPhase
  /** Rehabilitación opcional asociada a la fotografía. */
  rehabId?: string
  uploadedAt?: string
  validatedAt?: string
  rejectedAt?: string
  rejectReason?: string
  createdAt: string
}

export type FlipWorkflowStatus =
  | 'review'
  | 'offer_submitted'
  | 'under_contract_purchase'
  | 'purchased'
  | 'rehab'
  | 'listed'
  | 'under_contract_sale'
  | 'sold'
  | 'cancelled'

export type FlipRehabCategory =
  | 'kitchen'
  | 'bathroom'
  | 'flooring'
  | 'electrical'
  | 'plumbing'
  | 'roof'
  | 'paint'
  | 'hvac'
  | 'landscaping'
  | 'hoa'
  | 'dumpster'
  | 'permits'
  | 'lawyer'
  | 'other'

export type FlipRehabStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'
export type FlipPurchaseType = 'mls' | 'auction' | 'reo' | 'short_sale'
export type FlipDueDiligencePhase = 'review' | 'budget_analysis' | 'rehab' | 'listing'

/** Proyecto operativo Fix & Flip (1:1 con activo type=flip). */
export type FlipProject = {
  assetId: string
  tenantId: string
  address?: string
  purchaseType?: FlipPurchaseType
  workflowStatus: FlipWorkflowStatus
  workflowUpdatedAt?: string
  workflowUpdatedBy?: string
  workflowComment?: string
  /** @deprecated Usar Asset.acquisitionDate. Campo legado; no se acepta en escritura. */
  purchaseDate?: string
  estimatedSaleDate?: string
  actualSaleDate?: string
  createdAt: string
  updatedAt: string
}

export type FlipDueDiligenceItem = {
  id: string
  tenantId: string
  assetId: string
  phase: FlipDueDiligencePhase
  name: string
  completed: boolean
  completedAt?: string
  completedBy?: string
  notes?: string
  sortOrder?: number
  createdAt: string
  updatedAt: string
}

export type FlipRehab = {
  id: string
  tenantId: string
  assetId: string
  date: string
  category: FlipRehabCategory
  description?: string
  vendorId?: string
  vendorName?: string
  amount: number
  status: FlipRehabStatus
  notes?: string
  costFactId?: string
  /** Reservado para agrupar rehabs por fase en evoluciones futuras. */
  phaseId?: string
  createdAt: string
  updatedAt: string
}

/** Catálogo transversal de proveedores del tenant; UI inicial disponible en Flipping. */
export type Vendor = {
  id: string
  tenantId: string
  name: string
  phone?: string
  email?: string
  specialty?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

/** Plantilla de documento obligatorio/opcional por tipo de entidad. */
export type DocumentRequirement = {
  id: string
  tenantId: string
  entityType: string
  name: string
  description?: string
  required: boolean
  region?: string
  createdAt: string
}
