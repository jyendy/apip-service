/**
 * Motor financiero (MVP). Las fórmulas son versionables; ajustar según definición contable del producto.
 * calculationVersion: bump cuando cambien reglas.
 */
export const CALCULATION_VERSION = '2026.04.0'

export type MonthlySeriesInput = {
  months: number
  monthlyRevenue: number
  monthlyCosts: number
  growthRateMonthly: number
  initialInvestment: number
}

export function buildMonthlyCashFlowSeries(input: MonthlySeriesInput): {
  revenue: number
  costs: number
  net: number
  cumulative: number
}[] {
  const out: { revenue: number; costs: number; net: number; cumulative: number }[] = []
  let cumulative = 0
  for (let i = 0; i < input.months; i++) {
    const g = Math.pow(1 + input.growthRateMonthly, i)
    const revenue = input.monthlyRevenue * g
    const costs = input.monthlyCosts * g
    const net = revenue - costs
    cumulative += net
    out.push({ revenue, costs, net, cumulative })
  }
  return out
}

export function simpleRoiPercent(netProfitApprox: number, initialInvestment: number): number {
  if (initialInvestment === 0) return 0
  return (netProfitApprox / initialInvestment) * 100
}

/** Activa logs de diagnóstico para `irrMonthlyPercent` (t0 + primeros valores del array). */
function debugIrrCashFlowsEnabled(): boolean {
  return process.env.APIP_DEBUG_IRR_CASHFLOWS === '1' || process.env.APIP_DEBUG_IRR_CASHFLOWS === 'true'
}

/**
 * IRR mensual resuelto por búsqueda binaria sobre N flujos mensuales; el primero suele ser -CAPEX.
 * Con `APIP_DEBUG_IRR_CASHFLOWS=1` imprime el array exacto recibido (t0 y primeros 5).
 */
export function irrMonthlyPercent(cashFlows: number[]): number {
  if (debugIrrCashFlowsEnabled()) {
    const t0 = cashFlows[0]
    const first5 = cashFlows.slice(0, 5)
    console.log(
      '[APIP_DEBUG_IRR_CASHFLOWS] irrMonthlyPercent: exact cashFlows length=%d\nt0 (index 0)=%s\nfirst5=%s',
      cashFlows.length,
      JSON.stringify(t0),
      JSON.stringify(first5),
    )
  }
  if (cashFlows.length === 0) return 0
  const npv = (r: number) =>
    cashFlows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0)
  let low = -0.9999
  let high = 10
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2
    const v = npv(mid)
    if (v > 0) low = mid
    else high = mid
  }
  const monthly = (low + high) / 2
  return (Math.pow(1 + monthly, 12) - 1) * 100
}

export function npvFromMonthlyFlows(
  cashFlows: number[],
  annualDiscountRate: number,
): number {
  const monthlyDiscount = Math.pow(1 + annualDiscountRate, 1 / 12) - 1
  return cashFlows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + monthlyDiscount, t), 0)
}

export function estimatePaybackMonthsFromSeries(netMonthlyFlows: number[], initialInvestment: number): number {
  let cum = 0
  for (let m = 0; m < netMonthlyFlows.length; m++) {
    cum += netMonthlyFlows[m]
    if (cum >= initialInvestment) return m + 1
  }
  return netMonthlyFlows.length
}
