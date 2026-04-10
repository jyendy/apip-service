import { describe, expect, it } from 'vitest'
import type { Asset, CostFact, RevenueFact } from '../domain/types'
import { computeAssetMetrics } from './metrics'

const baseAsset = (over: Partial<Asset> = {}): Asset =>
  ({
    id: 'a1',
    tenantId: 't1',
    portfolioId: 'p1',
    projectId: 'pr1',
    name: 'Test',
    type: 'other',
    acquisitionDate: '2024-01-15T00:00:00.000Z',
    initialInvestment: 100_000,
    currency: 'USD',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...over,
  }) as Asset

describe('computeAssetMetrics hybrid engine', () => {
  it('SIMULATION: solo financialModel, sin hechos', () => {
    const a = baseAsset({
      financialModel: {
        estimatedMonthlyRevenue: 10_000,
        estimatedMonthlyCost: 4_000,
        durationMonths: 3,
      },
    })
    const m = computeAssetMetrics(a, [], [])
    expect(m.dataMode).toBe('SIMULATION')
    expect(m.coverage).toEqual({ actualMonths: 0, projectedMonths: 3, totalMonths: 3 })
    expect(m.cashFlow).toHaveLength(3)
    expect(m.cashFlow.every(p => p.mode === 'PROJECTED')).toBe(true)
    expect(m.accumulatedRevenue).toBeCloseTo(30_000, 5)
    expect(m.totalCosts).toBeCloseTo(12_000, 5)
    expect(m.netProfit).toBeCloseTo(18_000, 5)
  })

  it('ACTUAL: solo hechos que cubren el horizonte sin modelo', () => {
    const rev: RevenueFact[] = [
      {
        id: 'r1',
        tenantId: 't1',
        assetId: 'a1',
        date: '2024-01-10T00:00:00.000Z',
        amount: 5_000,
        category: 'm',
        source: 'manual',
        createdAt: 'x',
      },
      {
        id: 'r2',
        tenantId: 't1',
        assetId: 'a1',
        date: '2024-02-10T00:00:00.000Z',
        amount: 6_000,
        category: 'm',
        source: 'manual',
        createdAt: 'x',
      },
    ]
    const cost: CostFact[] = [
      {
        id: 'c1',
        tenantId: 't1',
        assetId: 'a1',
        date: '2024-01-10T00:00:00.000Z',
        amount: 2_000,
        category: 'operational',
        source: 'manual',
        createdAt: 'x',
      },
      {
        id: 'c2',
        tenantId: 't1',
        assetId: 'a1',
        date: '2024-02-10T00:00:00.000Z',
        amount: 2_500,
        category: 'operational',
        source: 'manual',
        createdAt: 'x',
      },
    ]
    const m = computeAssetMetrics(baseAsset(), rev, cost)
    expect(m.dataMode).toBe('ACTUAL')
    expect(m.coverage.actualMonths).toBe(2)
    expect(m.coverage.projectedMonths).toBe(0)
    expect(m.cashFlow.every(p => p.mode === 'ACTUAL')).toBe(true)
    expect(m.accumulatedRevenue).toBe(11_000)
    expect(m.totalCosts).toBe(4_500)
  })

  it('HYBRID: modelo más largo que hechos; meses sin hechos son PROJECTED', () => {
    const a = baseAsset({
      financialModel: {
        estimatedMonthlyRevenue: 1_000,
        estimatedMonthlyCost: 400,
        durationMonths: 3,
      },
    })
    const rev: RevenueFact[] = [
      {
        id: 'r1',
        tenantId: 't1',
        assetId: 'a1',
        date: '2024-01-05T00:00:00.000Z',
        amount: 2_000,
        category: 'm',
        source: 'api',
        createdAt: 'x',
      },
    ]
    const m = computeAssetMetrics(a, rev, [])
    expect(m.dataMode).toBe('HYBRID')
    expect(m.coverage).toMatchObject({ actualMonths: 1, projectedMonths: 2, totalMonths: 3 })
    expect(m.cashFlow[0].mode).toBe('ACTUAL')
    expect(m.cashFlow[1].mode).toBe('PROJECTED')
    expect(m.cashFlow[2].mode).toBe('PROJECTED')
  })
})
