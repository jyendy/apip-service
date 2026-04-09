import { describe, expect, it } from 'vitest'
import {
  buildMonthlyCashFlowSeries,
  irrMonthlyPercent,
  npvFromMonthlyFlows,
  simpleRoiPercent,
} from './engine'

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
