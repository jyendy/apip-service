import { z } from 'zod'

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
  assetType: z.enum(['transport', 'real_estate', 'machinery', 'energy', 'other']),
  initialCapital: z.number().positive(),
  expectedMonthlyRevenue: z.number().nonnegative(),
  expectedOperatingCost: z.number().nonnegative(),
  growthRatePercent: z.number().optional(),
  durationMonths: z.number().int().positive().max(600),
  discountRateAnnual: z.number().optional(),
})

export const importAssetsBody = z.object({
  fileName: z.string().min(1),
  templateVersion: z.string().optional(),
})
