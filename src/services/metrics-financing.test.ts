import { describe, expect, it } from 'vitest'
import type { Asset, AssetFinancing } from '../domain/types'
import { computeAssetFinancialPackage, computeAssetMetrics } from './metrics'

const baseAsset = (over: Partial<Asset> = {}): Asset =>
  ({
    id: 'a1',
    tenantId: 't1',
    portfolioId: 'p1',
    projectId: 'pr1',
    name: 'Test',
    type: 'other',
    acquisitionDate: '2024-01-15T00:00:00.000Z',
    initialInvestment: 1_100_000,
    currency: 'USD',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    financialModel: {
      estimatedMonthlyRevenue: 50_000,
      estimatedMonthlyCost: 30_000,
      durationMonths: 60,
    },
    ...over,
  }) as Asset

const sampleFinancing = (): AssetFinancing => ({
  id: 'f1',
  tenantId: 't1',
  assetId: 'a1',
  principal: 800_000,
  annualInterestRate: 12,
  termMonths: 48,
  startDate: '2024-01-15T00:00:00.000Z',
  amortizationType: 'french',
  downPayment: 300_000,
  createdAt: 'x',
  updatedAt: 'x',
})

describe('computeAssetFinancialPackage', () => {
  it('sin financiamiento: equity null', () => {
    const a = baseAsset()
    const pkg = computeAssetFinancialPackage(a, [], [], null)
    expect(pkg.financing).toBeNull()
    expect(pkg.metrics.equity).toBeNull()
    expect(pkg.metrics.asset).toEqual(computeAssetMetrics(a, [], []))
  })

  it('con financiamiento: cuota deuda > 0 y flujo equity neto menor al operativo en meses con pago', () => {
    const a = baseAsset()
    const f = sampleFinancing()
    const pkg = computeAssetFinancialPackage(a, [], [], f)
    expect(pkg.financing).not.toBeNull()
    expect(pkg.metrics.equity).not.toBeNull()
    const row = pkg.metrics.equity!.cashFlow[0]!
    expect(row.debtService).toBeGreaterThan(0)
    expect(row.netCashFlow).toBeLessThan(row.operatingNetCashFlow!)
  })
})
