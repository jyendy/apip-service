/**
 * Motor financiero (MVP). Las fórmulas son versionables; ajustar según definición contable del producto.
 * calculationVersion: bump cuando cambien reglas.
 */
export const CALCULATION_VERSION = '2026.04.1'

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

/** Crecimiento compuesto distinto para ingresos y costos (misma convención que `projectedRevCost` en métricas de activo). */
export function buildMonthlyCashFlowSeriesDualGrowth(input: {
  months: number
  monthlyRevenue: number
  monthlyCosts: number
  revenueGrowthRateMonthly: number
  costGrowthRateMonthly: number
}): { revenue: number; costs: number; net: number; cumulative: number }[] {
  const out: { revenue: number; costs: number; net: number; cumulative: number }[] = []
  let cumulative = 0
  for (let i = 0; i < input.months; i++) {
    const gRev = Math.pow(1 + input.revenueGrowthRateMonthly, i)
    const gCost = Math.pow(1 + input.costGrowthRateMonthly, i)
    const revenue = input.monthlyRevenue * gRev
    const costs = input.monthlyCosts * gCost
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

/** Activa logs de diagnóstico para IRR (flujos + resolución). */
function debugIrrCashFlowsEnabled(): boolean {
  return process.env.APIP_DEBUG_IRR_CASHFLOWS === '1' || process.env.APIP_DEBUG_IRR_CASHFLOWS === 'true'
}

const IRR_NEWTON_MAX_ITER = 50
const IRR_NEWTON_TOL_NPV = 1e-7
const IRR_NEWTON_TOL_R = 1e-14
const IRR_NEWTON_R0 = 0.02
const IRR_NEWTON_R_MAX = 5
const IRR_BISECTION_MAX_ITER = 100
const IRR_BISECTION_TOL_NPV = 1e-12
const IRR_BISECTION_TOL_BRACKET = 1e-15

function npvAtMonthlyRate(cashFlows: number[], r: number): number {
  if (r <= -1) return Number.NaN
  let acc = 0
  for (let t = 0; t < cashFlows.length; t++) {
    acc += cashFlows[t]! / Math.pow(1 + r, t)
  }
  return acc
}

/** d/dr NPV(r) = Σ -t·cf_t / (1+r)^(t+1) */
function dNpvDrMonthly(cashFlows: number[], r: number): number {
  if (r <= -1) return Number.NaN
  let acc = 0
  for (let t = 1; t < cashFlows.length; t++) {
    const cf = cashFlows[t]!
    acc += (-t * cf) / Math.pow(1 + r, t + 1)
  }
  return acc
}

/**
 * IRR mensual (tasa por periodo) vía Newton-Raphson sobre NPV(r)=0.
 * @returns tasa mensual e iteraciones, o `null` si no converge
 */
export function irrNewton(cashFlows: number[]): { rate: number; iterations: number } | null {
  if (cashFlows.length === 0) return null
  let r = IRR_NEWTON_R0
  for (let i = 0; i < IRR_NEWTON_MAX_ITER; i++) {
    if (r <= -1 + 1e-12 || r > IRR_NEWTON_R_MAX) return null
    const f = npvAtMonthlyRate(cashFlows, r)
    if (!Number.isFinite(f)) return null
    if (Math.abs(f) < IRR_NEWTON_TOL_NPV) return { rate: r, iterations: i + 1 }
    const df = dNpvDrMonthly(cashFlows, r)
    if (!Number.isFinite(df) || Math.abs(df) < 1e-18) return null
    const step = f / df
    const rNext = r - step
    if (!Number.isFinite(rNext) || rNext <= -1 + 1e-12 || rNext > IRR_NEWTON_R_MAX) return null
    if (Math.abs(rNext - r) < IRR_NEWTON_TOL_R) return { rate: rNext, iterations: i + 1 }
    r = rNext
  }
  return null
}

function findBisectionBracket(cashFlows: number[]): { low: number; high: number } | null {
  let low = -0.9
  let high = 0.5
  for (let expansion = 0; expansion < 3; expansion++) {
    const fl = npvAtMonthlyRate(cashFlows, low)
    const fh = npvAtMonthlyRate(cashFlows, high)
    if (Number.isFinite(fl) && Number.isFinite(fh) && fl * fh < 0) return { low, high }
    high = Math.min(high + 0.5, 4)
    low = Math.max(low - 0.15, -0.99 + 1e-9)
  }
  const fl = npvAtMonthlyRate(cashFlows, low)
  const fh = npvAtMonthlyRate(cashFlows, high)
  if (Number.isFinite(fl) && Number.isFinite(fh) && fl * fh < 0) return { low, high }
  return null
}

function irrBisection(
  cashFlows: number[],
  low: number,
  high: number,
): { rate: number; iterations: number } | null {
  let lo = low
  let hi = high
  if (lo > hi) [lo, hi] = [hi, lo]
  let fLo = npvAtMonthlyRate(cashFlows, lo)
  let fHi = npvAtMonthlyRate(cashFlows, hi)
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi >= 0) return null

  for (let iter = 0; iter < IRR_BISECTION_MAX_ITER; iter++) {
    const mid = (lo + hi) * 0.5
    const fMid = npvAtMonthlyRate(cashFlows, mid)
    if (!Number.isFinite(fMid)) return null
    if (Math.abs(fMid) < IRR_BISECTION_TOL_NPV || hi - lo < IRR_BISECTION_TOL_BRACKET) {
      return { rate: mid, iterations: iter + 1 }
    }
    if (fLo * fMid <= 0) {
      hi = mid
      fHi = fMid
    } else {
      lo = mid
      fLo = fMid
    }
  }
  return { rate: (lo + hi) * 0.5, iterations: IRR_BISECTION_MAX_ITER }
}

function monthlyToAnnualEffectivePercent(monthlyRate: number): number {
  return (Math.pow(1 + monthlyRate, 12) - 1) * 100
}

/**
 * IRR a partir de flujos **mensuales** (índice 0 suele ser -CAPEX).
 * Resuelve la tasa mensual r con NPV(r)=0 y devuelve **TIR anual efectiva en %**.
 *
 * Orden: Newton-Raphson; si falla, bisección con bracket [-0.9, 0.5] ampliado hasta 3 veces.
 * Con `APIP_DEBUG_IRR_CASHFLOWS=1` registra flujos (inicio) y resultado del solver.
 */
export function irrMonthlyPercent(cashFlows: number[]): number {
  return computeIrrFromMonthlyFlows(cashFlows).annualRate
}

export type IrrComputationResult = {
  annualRate: number
  monthlyRate: number | null
  methodUsed: 'newton' | 'bisection' | 'none'
  iterations: number
  npvAtRate: number | null
}

export function computeIrrFromMonthlyFlows(cashFlows: number[]): IrrComputationResult {
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
  if (cashFlows.length === 0) {
    return {
      annualRate: 0,
      monthlyRate: null,
      methodUsed: 'none',
      iterations: 0,
      npvAtRate: null,
    }
  }

  const scaleTol = Math.max(
    1,
    cashFlows.reduce((m, cf) => Math.max(m, Math.abs(cf)), 0),
  )

  let monthlyRate: number | null = null
  let iterations = 0
  let methodUsed: 'newton' | 'bisection' | 'none' = 'none'

  const newtonOut = irrNewton(cashFlows)
  if (newtonOut !== null) {
    const npvCheck = npvAtMonthlyRate(cashFlows, newtonOut.rate)
    if (Number.isFinite(npvCheck) && Math.abs(npvCheck) < 1e-6 * scaleTol) {
      monthlyRate = newtonOut.rate
      methodUsed = 'newton'
      iterations = newtonOut.iterations
    }
  }

  if (monthlyRate === null) {
    const bracket = findBisectionBracket(cashFlows)
    if (bracket) {
      const bis = irrBisection(cashFlows, bracket.low, bracket.high)
      if (bis) {
        monthlyRate = bis.rate
        methodUsed = 'bisection'
        iterations = bis.iterations
      }
    }
  }

  if (monthlyRate === null || !Number.isFinite(monthlyRate)) {
    if (debugIrrCashFlowsEnabled()) {
      console.log(
        JSON.stringify({
          tag: 'APIP_DEBUG_IRR_SOLVE',
          monthlyRate: null,
          annualRate: 0,
          iterations: 0,
          methodUsed: 'none',
        }),
      )
    }
    return {
      annualRate: 0,
      monthlyRate: null,
      methodUsed: 'none',
      iterations: 0,
      npvAtRate: null,
    }
  }

  const annualPercent = monthlyToAnnualEffectivePercent(monthlyRate)

  if (annualPercent < -100 || annualPercent > 100) {
    console.warn('[IRR] Resultado fuera de rango habitual (-100% … +100% anual efectivo)', {
      monthlyRate,
      annualPercent,
      methodUsed,
    })
  }

  if (debugIrrCashFlowsEnabled()) {
    console.log(
      JSON.stringify({
        tag: 'APIP_DEBUG_IRR_SOLVE',
        monthlyRate,
        annualRate: annualPercent,
        iterations,
        methodUsed,
        npvAtRate: npvAtMonthlyRate(cashFlows, monthlyRate),
      }),
    )
  }

  return {
    annualRate: annualPercent,
    monthlyRate,
    methodUsed,
    iterations,
    npvAtRate: npvAtMonthlyRate(cashFlows, monthlyRate),
  }
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
