import { describe, expect, it } from 'vitest'
import { frenchMonthlyPayment, generateAmortizationSchedule } from './financing'

describe('frenchMonthlyPayment', () => {
  it('caso validación: 800k, 12% anual, 48 meses', () => {
    const pmt = frenchMonthlyPayment(800_000, 12, 48)
    expect(pmt).toBeGreaterThan(19_000)
    expect(pmt).toBeLessThan(22_000)
  })
})

describe('generateAmortizationSchedule', () => {
  it('suma de principal amortizado ≈ principal', () => {
    const sch = generateAmortizationSchedule({ principal: 100_000, annualInterestRate: 6, termMonths: 12 })
    expect(sch).toHaveLength(12)
    const sumPrin = sch.reduce((s, x) => s + x.principal, 0)
    expect(sumPrin).toBeCloseTo(100_000, -1)
    expect(sch[11]!.remainingBalance).toBeCloseTo(0, 0)
  })
})
