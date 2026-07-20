import { describe, expect, it } from 'vitest'
import type { Asset } from '../domain/types'
import { computeAssetMetrics } from './metrics'
import { financialModelFromFlipProForma, projectedFlipProFormaMonth } from './flip-proforma'

describe('flip pro-forma', () => {
  it('projects lump costs at start and ARV net of commission at end', () => {
    const proForma = {
      acquisitionFee: 5000,
      purchaseClosingCosts: 3000,
      projectedRehabCost: 40000,
      monthlyHoa: 200,
      monthlyTaxesInsurance: 300,
      resaleValue: 250000,
      realtorCommissionPct: 6,
      saleClosingCosts: 4000,
      holdingMonths: 6,
    }

    const start = projectedFlipProFormaMonth(proForma, 0, 6)
    expect(start.rev).toBe(0)
    expect(start.cost).toBe(5000 + 3000 + 40000 + 200 + 300)

    const end = projectedFlipProFormaMonth(proForma, 5, 6)
    expect(end.rev).toBe(250000)
    expect(end.cost).toBeCloseTo(200 + 300 + 4000 + 250000 * 0.06, 5)
  })

  it('derives a zero-revenue financial model for asset sync', () => {
    const fm = financialModelFromFlipProForma({
      monthlyHoa: 150,
      monthlyTaxesInsurance: 250,
      holdingMonths: 8,
    })
    expect(fm.estimatedMonthlyRevenue).toBe(0)
    expect(fm.estimatedMonthlyCost).toBe(400)
    expect(fm.durationMonths).toBe(8)
  })
})

describe('computeAssetMetrics with flip pro-forma', () => {
  const asset: Asset = {
    id: 'flip1',
    tenantId: 't1',
    portfolioId: 'p1',
    projectId: 'pr1',
    name: 'Flip',
    type: 'flip',
    acquisitionDate: '2026-01-01T00:00:00.000Z',
    initialInvestment: 180000,
    currency: 'USD',
    status: 'active',
    createdAt: 'x',
    updatedAt: 'x',
  }

  it('produces positive projected ROI when ARV exceeds costs and investment', () => {
    const proForma = {
      projectedRehabCost: 30000,
      monthlyHoa: 0,
      monthlyTaxesInsurance: 500,
      resaleValue: 280000,
      realtorCommissionPct: 5,
      saleClosingCosts: 3000,
      holdingMonths: 4,
    }
    const m = computeAssetMetrics(asset, [], [], { flipProForma: proForma })
    expect(m.dataMode).toBe('SIMULATION')
    expect(m.coverage.totalMonths).toBe(4)
    expect(m.netProfit).toBeGreaterThan(0)
    expect(m.roi).toBeGreaterThan(0)
  })
})
