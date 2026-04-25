import { z } from 'zod'

export const createTenantBody = z.object({
  name: z.string().min(1),
  type: z.enum(['fund', 'company', 'family_office', 'other']),
  id: z.string().min(1).optional(),
})

export const patchTenantBody = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['fund', 'company', 'family_office', 'other']).optional(),
})

export const createPortfolioBody = z.object({
  name: z.string().min(1),
  strategy: z.string().optional(),
  baseCurrency: z.string().length(3).optional(),
})

export const patchPortfolioBody = createPortfolioBody.partial()

export const createProjectBody = z.object({
  portfolioId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['planning', 'active', 'completed', 'on_hold']).optional(),
  budget: z.number().nonnegative().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
})

export const patchProjectBody = createProjectBody.partial().omit({ portfolioId: true })

const financialModelSchema = z
  .object({
    estimatedMonthlyRevenue: z.number().nonnegative(),
    estimatedMonthlyCost: z.number().nonnegative(),
    durationMonths: z.number().int().positive().max(600),
    revenueGrowthRate: z.number().optional(),
    costGrowthRate: z.number().optional(),
  })
  .optional()

export const createAssetBody = z.object({
  portfolioId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['transport', 'real_estate', 'machinery', 'energy', 'other']),
  acquisitionDate: z.string().datetime(),
  initialInvestment: z.number(),
  currency: z.string().length(3).default('USD'),
  status: z.enum(['active', 'inactive', 'maintenance', 'sold']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  financialModel: financialModelSchema,
})

export const patchAssetBody = createAssetBody.partial().omit({ portfolioId: true, projectId: true })

export const listQuery = z.object({
  projectId: z.string().optional(),
  portfolioId: z.string().optional(),
  type: z.enum(['transport', 'real_estate', 'machinery', 'energy', 'other']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
})

export const simulationFinancingBody = z.object({
  principal: z.number().positive(),
  annualInterestRate: z.number().nonnegative(),
  termMonths: z.number().int().positive().max(600),
  downPayment: z.number().nonnegative(),
  firstPaymentMonthOffset: z.number().int().min(0).max(600).optional(),
})

export const simulationBody = z.object({
  name: z.string().min(1).optional(),
  assetType: z.enum(['transport', 'real_estate', 'machinery', 'energy', 'other']),
  initialCapital: z.number().positive(),
  expectedMonthlyRevenue: z.number().nonnegative(),
  expectedOperatingCost: z.number().nonnegative(),
  /** Si no hay revenue/cost growth, se usa para ambos (legado). */
  growthRatePercent: z.number().min(0).max(100).optional(),
  revenueGrowthRatePercent: z.number().min(0).max(100).optional(),
  costGrowthRatePercent: z.number().min(0).max(100).optional(),
  durationMonths: z.number().int().positive().max(600),
  discountRateAnnual: z.number().optional(),
  financing: simulationFinancingBody.optional(),
})

export const patchSimulationBody = simulationBody.partial().extend({
  financing: z.union([simulationFinancingBody, z.null()]).optional(),
})

const importAssetRowSchema = z.object({
  portfolioId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['transport', 'real_estate', 'machinery', 'energy', 'other']),
  acquisitionDate: z.string().datetime(),
  initialInvestment: z.number(),
  currency: z.string().length(3).optional(),
  status: z.enum(['active', 'inactive', 'maintenance', 'sold']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  financialModel: financialModelSchema,
})

export const importAssetsBody = z
  .object({
    fileName: z.string().min(1).optional(),
    templateVersion: z.string().optional(),
    rows: z.array(importAssetRowSchema).max(500).optional(),
  })
  .refine(b => !!(b.fileName && b.fileName.length > 0) || !!(b.rows && b.rows.length > 0), {
    message: 'Indica fileName (job registrado) o rows (importación síncrona de activos)',
  })

export const createInvestorBody = z.object({
  name: z.string().min(1),
  role: z.enum(['limited_partner', 'general_partner', 'advisor', 'stakeholder', 'other']),
  email: z.string().email().optional(),
  portfolioIds: z.array(z.string().min(1)).default([]),
  committedCapital: z.number().nonnegative().optional(),
  notes: z.string().optional(),
})

export const patchInvestorBody = createInvestorBody.partial()

export const investorLedgerEntryBody = z.object({
  type: z.enum(['contribution', 'distribution']),
  amount: z.number().positive(),
  occurredAt: z.string().datetime(),
  note: z.string().optional(),
})

export const putProjectInvestorAllocationsBody = z.object({
  allocations: z.array(
    z.object({
      investorId: z.string().min(1),
      amount: z.number().nonnegative(),
    }),
  ),
})

export const createTmsCustomerBody = z.object({
  name: z.string().min(1),
  taxId: z.string().optional(),
  notes: z.string().optional(),
})

export const patchTmsCustomerBody = createTmsCustomerBody.partial()

export const createTmsLocalityBody = z.object({
  name: z.string().min(1),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  notes: z.string().optional(),
})

export const patchTmsLocalityBody = createTmsLocalityBody.partial()

export const createTmsProviderBody = z.object({
  name: z.string().min(1),
  isOwnFleet: z.boolean().optional(),
  taxId: z.string().optional(),
  notes: z.string().optional(),
})

export const patchTmsProviderBody = createTmsProviderBody.partial()

export const createTmsDriverBody = z.object({
  providerId: z.string().min(1),
  name: z.string().min(1),
  licenseNumber: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
})

export const patchTmsDriverBody = createTmsDriverBody.partial().omit({ providerId: true })

export const createTmsVehicleUnitBody = z.object({
  providerId: z.string().min(1),
  assetId: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  plate: z.string().optional(),
  capacityPackages: z.number().int().positive().optional(),
  notes: z.string().optional(),
})

export const patchTmsVehicleUnitBody = createTmsVehicleUnitBody.partial().omit({ providerId: true })

export const createTmsRateBody = z.object({
  customerId: z.string().min(1),
  originLocalityId: z.string().min(1),
  destinationLocalityId: z.string().min(1),
  providerId: z.string().min(1),
  buyPrice: z.number().nonnegative(),
  sellPrice: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
})

export const patchTmsRateBody = createTmsRateBody.partial()

export const createTmsRouteBody = z.object({
  name: z.string().min(1),
  originLocalityId: z.string().min(1),
  destinationLocalityId: z.string().min(1),
  stops: z.array(
    z.object({
      sequence: z.number().int().positive(),
      localityId: z.string().min(1),
      type: z.enum(['PICKUP', 'DROPOFF']),
      notes: z.string().optional(),
    }),
  ),
  notes: z.string().optional(),
})

export const patchTmsRouteBody = createTmsRouteBody.partial()

export const createTransportOrderBody = z.object({
  customerId: z.string().min(1),
  originLocalityId: z.string().min(1),
  destinationLocalityId: z.string().min(1),
  providerId: z.string().min(1),
  packageCount: z.number().int().positive(),
  cargoDescription: z.string().min(1),
  scheduledDate: z.string().datetime(),
  status: z.enum(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
})

export const patchTransportOrderBody = z.object({
  customerId: z.string().min(1).optional(),
  originLocalityId: z.string().min(1).optional(),
  destinationLocalityId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  packageCount: z.number().int().positive().optional(),
  cargoDescription: z.string().min(1).optional(),
  scheduledDate: z.string().datetime().optional(),
  status: z.enum(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
})

export const createTransportTripBody = z.object({
  assetId: z.string().min(1),
  orderIds: z.array(z.string().min(1)).min(1),
  providerId: z.string().min(1),
  driverId: z.string().min(1),
  vehicleUnitId: z.string().min(1),
  routeId: z.string().min(1).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  distanceKm: z.number().nonnegative().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
})

export const patchTransportTripBody = z.object({
  assetId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  driverId: z.string().min(1).optional(),
  vehicleUnitId: z.string().min(1).optional(),
  routeId: z.string().min(1).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  distanceKm: z.number().nonnegative().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
  orderIds: z.array(z.string().min(1)).optional(),
})

const importTmsRateRowSchema = z.object({
  customerId: z.string().min(1),
  originLocalityId: z.string().min(1),
  destinationLocalityId: z.string().min(1),
  providerId: z.string().min(1),
  buyPrice: z.number().nonnegative(),
  sellPrice: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
})

export const importTmsRatesBody = z.object({
  fileName: z.string().min(1).optional(),
  templateVersion: z.string().optional(),
  rows: z.array(importTmsRateRowSchema).max(3000).optional(),
})

const importTmsOrderTripRowSchema = z.object({
  customerId: z.string().min(1),
  originLocalityId: z.string().min(1),
  destinationLocalityId: z.string().min(1),
  providerId: z.string().min(1),
  packageCount: z.number().int().positive(),
  cargoDescription: z.string().min(1),
  scheduledDate: z.string().datetime(),
  orderStatus: z.enum(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
  assetId: z.string().min(1),
  driverId: z.string().min(1),
  vehicleUnitId: z.string().min(1),
  tripStatus: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
  routeId: z.string().min(1).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  distanceKm: z.number().nonnegative().optional(),
})

export const importTmsOrderTripsBody = z.object({
  fileName: z.string().min(1).optional(),
  templateVersion: z.string().optional(),
  rows: z.array(importTmsOrderTripRowSchema).max(3000).optional(),
})

export const tmsTripCostBody = z.object({
  assetId: z.string().min(1),
  date: z.string().datetime(),
  category: z.string().min(1),
  amount: z.number().positive(),
})

export const tmsTripRevenueBody = z.object({
  assetId: z.string().min(1),
  date: z.string().datetime(),
  amount: z.number().positive(),
})

export const createAccessRoleBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  permissionKeys: z.array(z.string().min(1)).min(1),
})

export const patchAccessRoleBody = createAccessRoleBody.partial()

export const putTenantUserProfileBody = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  photoUrl: z.string().url().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  roleIds: z.array(z.string().min(1)).optional(),
})

/** Perfil propio (sin asignación de roles; la gestión de roleIds será vía admin). */
export const putSelfUserProfileBody = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  photoUrl: z.string().url().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
})

export const putAssetCashFlowsBody = z.object({
  periods: z
    .array(
      z.object({
        period: z.string().regex(/^\d{4}-\d{2}$/),
        revenue: z.number().nonnegative(),
        cost: z.number().nonnegative(),
        source: z.enum(['manual', 'tms', 'erp', 'import', 'api']).optional(),
      }),
    )
    .min(1),
})

/** Crear/reemplazar el único financiamiento del activo (MVP). */
export const putAssetFinancingBody = z.object({
  principal: z.number().positive(),
  annualInterestRate: z.number().min(0).max(100),
  termMonths: z.number().int().min(1).max(600),
  startDate: z.string().min(8),
  amortizationType: z.literal('french'),
  downPayment: z.number().min(0),
})

const documentEntityTypeSchema = z.enum([
  'asset',
  'property',
  'lease',
  'flip_project',
  'due_diligence',
])

export const createDocumentBody = z.object({
  entityType: documentEntityTypeSchema,
  entityId: z.string().min(1),
  name: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().positive(),
  required: z.boolean(),
  requirementId: z.string().optional(),
  /** Obligatorio si la entidad no es un activo resuelto en servidor (p. ej. lease sin tabla propia). */
  portfolioId: z.string().optional(),
  projectId: z.string().optional(),
})

export const documentsListQuery = z.object({
  entityType: documentEntityTypeSchema,
  entityId: z.string().min(1),
  /** Obligatorio para entityType distinto de asset/property (alcance RBAC). */
  portfolioId: z.string().optional(),
  projectId: z.string().optional(),
})

const rbacRoleSchema = z.enum(['admin', 'investor', 'operator', 'analyst', 'auditor'])

export const rbacAssignmentInput = z.object({
  id: z.string().min(1).optional(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  role: rbacRoleSchema,
  portfolioId: z.string().optional(),
  projectId: z.string().optional(),
  createdAt: z.string().optional(),
})

export const patchAccessUserBody = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  photoUrl: z.string().url().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  roleIds: z.array(z.string().min(1)).optional(),
  rbacAssignments: z.array(rbacAssignmentInput).optional(),
})

export const rejectDocumentBody = z.object({
  reason: z.string().max(2000).optional(),
})

export const createDocumentRequirementBody = z.object({
  entityType: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean(),
  region: z.string().optional(),
})

export const documentRequirementsListQuery = z.object({
  entityType: z.string().min(1),
})
