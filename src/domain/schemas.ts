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

export const simulationBody = z.object({
  name: z.string().min(1).optional(),
  assetType: z.enum(['transport', 'real_estate', 'machinery', 'energy', 'other']),
  initialCapital: z.number().positive(),
  expectedMonthlyRevenue: z.number().nonnegative(),
  expectedOperatingCost: z.number().nonnegative(),
  growthRatePercent: z.number().optional(),
  durationMonths: z.number().int().positive().max(600),
  discountRateAnnual: z.number().optional(),
})

export const patchSimulationBody = simulationBody.partial()

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
  region: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
})

export const patchTmsLocalityBody = createTmsLocalityBody.partial()

export const createTransportOrderBody = z.object({
  customerId: z.string().min(1),
  originLocalityId: z.string().min(1),
  destinationLocalityId: z.string().min(1),
  cargoDescription: z.string().min(1),
  scheduledDate: z.string().datetime(),
  expectedRevenue: z.number().nonnegative(),
  status: z.enum(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
})

export const patchTransportOrderBody = z.object({
  customerId: z.string().min(1).optional(),
  originLocalityId: z.string().min(1).optional(),
  destinationLocalityId: z.string().min(1).optional(),
  cargoDescription: z.string().min(1).optional(),
  scheduledDate: z.string().datetime().optional(),
  expectedRevenue: z.number().nonnegative().optional(),
  status: z.enum(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
})

export const createTransportTripBody = z.object({
  assetId: z.string().min(1),
  orderIds: z.array(z.string().min(1)).min(1),
  driver: z.string().min(1),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  distanceKm: z.number().nonnegative().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
})

export const patchTransportTripBody = z.object({
  driver: z.string().min(1).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  distanceKm: z.number().nonnegative().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
  orderIds: z.array(z.string().min(1)).optional(),
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
