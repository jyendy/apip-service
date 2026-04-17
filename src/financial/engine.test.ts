import { describe, expect, it } from 'vitest'
import {
  buildMonthlyCashFlowSeries,
  irrMonthlyPercent,
  irrNewton,
  npvFromMonthlyFlows,
  simpleRoiPercent,
} from './engine'

/** NPV mensual en tasa r (misma convención que el motor). */
function npvMonthlyAt(cashFlows: number[], r: number): number {
  if (r <= -1) return Number.NaN
  return cashFlows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0)
}

describe('simpleRoiPercent', () => {
  it('calcula ROI básico', () => {
    expect(simpleRoiPercent(10000, 100000)).toBeCloseTo(10, 5)
    expect(simpleRoiPercent(0, 100)).toBe(0)
  })
})

describe('irrMonthlyPercent', () => {
  it('da IRR > 0 con flujos positivos tras inversión inicial', () => {
    const flows = [-1000, 400, 400, 400]
    const irr = irrMonthlyPercent(flows)
    expect(irr).toBeGreaterThan(0)
  })

  it('serie 60m: CAPEX 1.1M y netos crecientes ~77/mes — TIR coherente (NPV≈0)', () => {
    const flows = [-1_100_000]
    for (let m = 1; m <= 60; m++) flows.push(19000 + (m - 1) * 77)
    const irrAnnualPct = irrMonthlyPercent(flows)
    expect(irrAnnualPct).toBeGreaterThan(0)
    expect(irrAnnualPct).toBeLessThan(100)
    const monthlyFromAnnual = Math.pow(1 + irrAnnualPct / 100, 1 / 12) - 1
    const npv = npvMonthlyAt(flows, monthlyFromAnnual)
    expect(Math.abs(npv)).toBeLessThan(Math.abs(flows[0]!) * 1e-4)
  })

  it('irrNewton converge en flujo simple', () => {
    const flows = [-1000, 400, 400, 400]
    const out = irrNewton(flows)
    expect(out).not.toBeNull()
    expect(out!.iterations).toBeGreaterThan(0)
    expect(out!.iterations).toBeLessThanOrEqual(50)
  })
})

describe('npvFromMonthlyFlows', () => {
  it('NPV positivo con flujos constantes y tasa baja', () => {
    const flows = Array(12).fill(100)
    const npv = npvFromMonthlyFlows(flows, 0.1)
    expect(npv).toBeGreaterThan(0)
  })
})

describe('buildMonthlyCashFlowSeries', () => {
  it('acumula cash', () => {
    const s = buildMonthlyCashFlowSeries({
      months: 3,
      monthlyRevenue: 100,
      monthlyCosts: 40,
      growthRateMonthly: 0,
      initialInvestment: 0,
    })
    expect(s).toHaveLength(3)
    expect(s[2].cumulative).toBeCloseTo(180, 5)
  })
})
