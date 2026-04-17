import type { SimulationEquityMetrics, SimulationFinancingStored } from '../domain/types'
import {
  buildMonthlyCashFlowSeries,
  estimatePaybackMonthsFromSeries,
  irrMonthlyPercent,
  npvFromMonthlyFlows,
  simpleRoiPercent,
} from '../financial/engine'
import { buildDebtServiceByMonth, generateAmortizationSchedule } from './financing'

/**
 * Proyección del Simulation Lab: vista sin deuda (como antes) y, si hay préstamo, métricas **equity**
 * (flujo operativo menos cuota; TIR con [-enganche, …]; NPV/payback homólogos a `computeAssetFinancialPackage`).
 */
export function computeSimulationProjection(input: {
  initialCapital: number
  expectedMonthlyRevenue: number
  expectedOperatingCost: number
  growthRatePercent?: number
  durationMonths: number
  discountRateAnnual?: number
  financing?: SimulationFinancingStored | null
}): {
  roi: number
  irr: number
  npv: number
  breakEvenMonth: number
  equityMetrics: SimulationEquityMetrics | null
} {
  const growthMonthly = (input.growthRatePercent ?? 0) / 100 / 12
  const disc = input.discountRateAnnual ?? 0.1
  const series = buildMonthlyCashFlowSeries({
    months: input.durationMonths,
    monthlyRevenue: input.expectedMonthlyRevenue,
    monthlyCosts: input.expectedOperatingCost,
    growthRateMonthly: growthMonthly,
    initialInvestment: input.initialCapital,
  })
  const nets = series.map(s => s.net)
  const flows = [-input.initialCapital, ...nets]
  const irr = irrMonthlyPercent(flows)
  const npv = npvFromMonthlyFlows(nets, disc)
  const totalProfit = nets.reduce((a, s) => a + s, 0)
  const roi = simpleRoiPercent(totalProfit, input.initialCapital)
  const breakEvenMonth = series.findIndex((_row, i) => {
    const cum = series.slice(0, i + 1).reduce((x, y) => x + y.net, 0)
    return cum >= input.initialCapital
  })

  const fin = input.financing
  let equityMetrics: SimulationEquityMetrics | null = null
  if (fin && fin.principal > 0) {
    const sumCap = fin.principal + fin.downPayment
    if (Math.abs(sumCap - input.initialCapital) > 0.01 * Math.max(input.initialCapital, 1)) {
      console.warn('[simulation] principal + downPayment no coincide con initialCapital', {
        principal: fin.principal,
        downPayment: fin.downPayment,
        initialCapital: input.initialCapital,
      })
    }
    const schedule = generateAmortizationSchedule(fin)
    const offset = Math.max(0, fin.firstPaymentMonthOffset ?? 0)
    const debtByMonth = buildDebtServiceByMonth(input.durationMonths, offset, schedule)
    const equityNets = nets.map((n, i) => n - (debtByMonth[i] ?? 0))
    const down = fin.downPayment
    const equityNetProfit = equityNets.reduce((a, b) => a + b, 0)
    const roiEq = down > 0 ? simpleRoiPercent(equityNetProfit, down) : 0
    const flowsEq = down > 0 ? [-down, ...equityNets] : []
    const irrEq = equityNets.length && down > 0 ? irrMonthlyPercent(flowsEq) : 0
    const npvEq = equityNets.length ? npvFromMonthlyFlows(equityNets, disc) : 0
    const payEq = down > 0 && equityNets.length ? estimatePaybackMonthsFromSeries(equityNets, down) : 0
    equityMetrics = {
      projectedROI: roiEq,
      projectedIRR: irrEq,
      projectedNPV: npvEq,
      breakEvenMonth: payEq,
    }
  }

  return { roi, irr, npv, breakEvenMonth, equityMetrics }
}
