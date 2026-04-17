import { describe, expect, it } from 'vitest'
import { computeSimulationProjection } from './simulation-projection'
import { buildDebtServiceByMonth, generateAmortizationSchedule } from './financing'

describe('computeSimulationProjection', () => {
  it('sin financiamiento: equityMetrics null', () => {
    const p = computeSimulationProjection({
      initialCapital: 100_000,
      expectedMonthlyRevenue: 5_000,
      expectedOperatingCost: 2_000,
      growthRatePercent: 0,
      durationMonths: 12,
      discountRateAnnual: 0.1,
      financing: null,
    })
    expect(p.equityMetrics).toBeNull()
    expect(p.irr).not.toBe(0)
  })

  it('con francés: equityMetrics y cuotas alineadas a generateAmortizationSchedule', () => {
    const initialCapital = 500_000
    const principal = 400_000
    const down = 100_000
    const p = computeSimulationProjection({
      initialCapital,
      expectedMonthlyRevenue: 10_000,
      expectedOperatingCost: 3_000,
      growthRatePercent: 0,
      durationMonths: 24,
      discountRateAnnual: 0.1,
      financing: {
        principal,
        annualInterestRate: 12,
        termMonths: 24,
        downPayment: down,
        firstPaymentMonthOffset: 0,
      },
    })
    expect(p.equityMetrics).not.toBeNull()
    const sch = generateAmortizationSchedule({ principal, annualInterestRate: 12, termMonths: 24 })
    const debt = buildDebtServiceByMonth(24, 0, sch)
    expect(debt[0]).toBeCloseTo(sch[0]!.payment, 5)
    // Equity distinto de sin deuda cuando hay cuota
    expect(p.equityMetrics!.projectedIRR).not.toBe(p.irr)
  })
})
