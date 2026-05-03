import { describe, expect, it } from 'vitest'
import type { AssetFinancialMetricsPackage, AssetMetricsComputed, CashFlowPoint } from '../domain/types'
import { aggregateFinancialPackages } from './aggregate-metrics'

function point(ym: string, netCashFlow: number): CashFlowPoint {
  return {
    date: `${ym}-01T00:00:00.000Z`,
    revenue: Math.max(netCashFlow, 0),
    costs: Math.max(-netCashFlow, 0),
    netCashFlow,
    cumulativeCashFlow: netCashFlow,
    mode: 'PROJECTED',
  }
}

function metrics(assetId: string, initialInvestment: number, series: Array<[string, number]>): AssetMetricsComputed {
  const cashFlow = series.map(([ym, net]) => point(ym, net))
  return {
    assetId,
    initialInvestment,
    accumulatedRevenue: cashFlow.reduce((s, x) => s + x.revenue, 0),
    totalCosts: cashFlow.reduce((s, x) => s + x.costs, 0),
    operatingCosts: cashFlow.reduce((s, x) => s + x.costs, 0),
    ebitda: cashFlow.reduce((s, x) => s + x.netCashFlow, 0),
    netProfit: cashFlow.reduce((s, x) => s + x.netCashFlow, 0),
    roi: 0,
    irr: 0,
    paybackPeriodMonths: 0,
    npv: 0,
    cashFlow,
    dataMode: 'SIMULATION',
    coverage: { actualMonths: 0, projectedMonths: cashFlow.length, totalMonths: cashFlow.length },
    calculationVersion: 'test',
  }
}

function pkg(
  assetId: string,
  assetInitial: number,
  assetSeries: Array<[string, number]>,
  equity?: { initial: number; series: Array<[string, number]> },
): AssetFinancialMetricsPackage {
  return {
    assetId,
    calculationVersion: 'test',
    metrics: {
      asset: metrics(assetId, assetInitial, assetSeries),
      equity: equity ? metrics(assetId, equity.initial, equity.series) : null,
    },
    financing: equity
      ? {
          id: `f-${assetId}`,
          principal: assetInitial - equity.initial,
          annualInterestRate: 10,
          termMonths: 12,
          startDate: `${assetSeries[0]![0]}-01T00:00:00.000Z`,
          amortizationType: 'french',
          downPayment: equity.initial,
          monthlyPayment: 1,
          schedule: [],
        }
      : null,
  }
}

describe('aggregateFinancialPackages', () => {
  it('agrega serie mensual alineando fechas de inicio', () => {
    const a = pkg('A', 100, [
      ['2026-01', 50],
      ['2026-02', 50],
    ])
    const b = pkg('B', 200, [
      ['2026-02', 0],
      ['2026-03', 300],
    ])
    const out = aggregateFinancialPackages('project', 'p-1', [a, b])
    expect(out.metrics.asset.initialInvestment).toBe(300)
    expect(out.metrics.asset.cashFlow.map(x => x.netCashFlow)).toEqual([50, 50, 300])
  })

  it('calcula equity solo con assets financiados', () => {
    const a = pkg('A', 100, [['2026-01', 10]], { initial: 30, series: [['2026-01', 9]] })
    const b = pkg('B', 200, [['2026-01', 20]])
    const out = aggregateFinancialPackages('portfolio', 'pf-1', [a, b])
    expect(out.metrics.equity?.initialInvestment).toBe(30)
    expect(out.excludedAssetIds).toEqual(['B'])
  })
})
