import type { AmortizationPayment, AssetFinancing } from '../domain/types'

/** Cuota fija mensual (sistema francés): \(P \cdot r / (1 - (1+r)^{-n})\), \(r\) = tasa mensual. */
export function frenchMonthlyPayment(principal: number, annualInterestRatePercent: number, termMonths: number): number {
  if (termMonths <= 0 || principal <= 0) return 0
  const r = annualInterestRatePercent / 100 / 12
  if (Math.abs(r) < 1e-15) return principal / termMonths
  const pow = Math.pow(1 + r, termMonths)
  return (principal * r * pow) / (pow - 1)
}

/**
 * Calendario de amortización alemán/francés: cuota constante, desglose capital/interés.
 * `monthIndex` 1…n (periodos del préstamo).
 */
export function generateAmortizationSchedule(f: Pick<AssetFinancing, 'principal' | 'annualInterestRate' | 'termMonths'>): AmortizationPayment[] {
  const n = Math.floor(f.termMonths)
  if (n <= 0 || f.principal <= 0) return []
  const payment = frenchMonthlyPayment(f.principal, f.annualInterestRate, n)
  const r = f.annualInterestRate / 100 / 12
  const out: AmortizationPayment[] = []
  let balance = f.principal
  for (let k = 1; k <= n; k++) {
    const interest = Math.abs(r) < 1e-15 ? 0 : balance * r
    const principalPart = payment - interest
    balance = Math.max(0, balance - principalPart)
    out.push({
      monthIndex: k,
      payment,
      principal: principalPart,
      interest,
      remainingBalance: balance,
    })
  }
  return out
}

/** Cuota total (capital+interés) por mes del horizonte; `offset` = índice del primer pago (0 = mes 0). */
export function buildDebtServiceByMonth(totalMonths: number, offset: number, schedule: { payment: number }[]): number[] {
  const debt = new Array<number>(totalMonths).fill(0)
  for (let k = 0; k < schedule.length; k++) {
    const i = offset + k
    if (i >= 0 && i < totalMonths) debt[i] = schedule[k]!.payment
  }
  return debt
}

export function financingPublicSnapshot(f: AssetFinancing, schedule: AmortizationPayment[]) {
  const monthlyPayment = schedule[0]?.payment ?? frenchMonthlyPayment(f.principal, f.annualInterestRate, f.termMonths)
  return {
    id: f.id,
    principal: f.principal,
    annualInterestRate: f.annualInterestRate,
    termMonths: f.termMonths,
    startDate: f.startDate,
    amortizationType: f.amortizationType as const,
    downPayment: f.downPayment,
    monthlyPayment,
    schedule,
  }
}
