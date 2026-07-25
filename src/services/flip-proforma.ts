import type { AssetFinancialModel, FlipProForma } from '../domain/types'

export function hasFlipProForma(proForma?: FlipProForma): boolean {
  if (!proForma) return false
  return (
    (proForma.holdingMonths != null && proForma.holdingMonths > 0) ||
    (proForma.resaleValue != null && proForma.resaleValue > 0) ||
    (proForma.projectedRehabCost != null && proForma.projectedRehabCost > 0) ||
    (proForma.acquisitionFee != null && proForma.acquisitionFee > 0) ||
    (proForma.purchaseClosingCosts != null && proForma.purchaseClosingCosts > 0) ||
    (proForma.monthlyHoa != null && proForma.monthlyHoa > 0) ||
    (proForma.monthlyTaxesInsurance != null && proForma.monthlyTaxesInsurance > 0) ||
    (proForma.saleClosingCosts != null && proForma.saleClosingCosts > 0) ||
    (proForma.realtorCommissionPct != null && proForma.realtorCommissionPct > 0)
  )
}

export function flipProFormaHorizonMonths(proForma: FlipProForma, modelMonths: number): number {
  const holding = proForma.holdingMonths ?? 0
  return Math.max(holding, modelMonths, 1)
}

/** Proyección mensual del deal flip (sin contar initialInvestment del activo). */
export function projectedFlipProFormaMonth(
  proForma: FlipProForma,
  monthIndex: number,
  totalMonths: number,
): { rev: number; cost: number } {
  let rev = 0
  let cost = (proForma.monthlyHoa ?? 0) + (proForma.monthlyTaxesInsurance ?? 0)

  if (monthIndex === 0) {
    cost += (proForma.acquisitionFee ?? 0) + (proForma.purchaseClosingCosts ?? 0) + (proForma.projectedRehabCost ?? 0)
  }

  if (totalMonths > 0 && monthIndex === totalMonths - 1) {
    const arv = proForma.resaleValue ?? 0
    rev += arv
    const commissionPct = proForma.realtorCommissionPct ?? 0
    const commission = arv > 0 && commissionPct > 0 ? arv * (commissionPct / 100) : 0
    cost += (proForma.saleClosingCosts ?? 0) + commission
  }

  return { rev, cost }
}

export function financialModelFromFlipProForma(proForma: FlipProForma): AssetFinancialModel {
  const monthlyCarry = (proForma.monthlyHoa ?? 0) + (proForma.monthlyTaxesInsurance ?? 0)
  return {
    estimatedMonthlyRevenue: 0,
    estimatedMonthlyCost: monthlyCarry,
    durationMonths: Math.max(1, proForma.holdingMonths ?? 6),
  }
}
