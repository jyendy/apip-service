import type { SimulationEquityMetrics, SimulationFinancingStored } from '../domain/types'
import {
  buildMonthlyCashFlowSeriesDualGrowth,
  estimatePaybackMonthsFromSeries,
  irrMonthlyPercent,
  npvFromMonthlyFlows,
  simpleRoiPercent,
} from '../financial/engine'
import { buildDebtServiceByMonth, generateAmortizationSchedule } from './financing'

/** Versión de la lógica de simulación (independiente de activos; subir al cambiar reglas del Lab). */
export const SIMULATION_CALCULATION_VERSION = '2026.04.2'

/**
 * Proyección del Simulation Lab: vista sin deuda (como antes) y, si hay préstamo, métricas **equity**
 * (flujo operativo menos cuota; TIR con [-enganche, …]; NPV/payback homólogos a `computeAssetFinancialPackage`).
 *
 * Crecimiento: `revenueGrowthRatePercent` / `costGrowthRatePercent` anuales compuestos en mensual (como activo);
 * si solo viene `growthRatePercent` (legado), se aplica a ambos.
 */
export function computeSimulationProjection(input: {
  initialCapital: number
  expectedMonthlyRevenue: number
  expectedOperatingCost: number
  growthRatePercent?: number
  revenueGrowthRatePercent?: number
  costGrowthRatePercent?: number
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
  const revAnnual = input.revenueGrowthRatePercent ?? input.growthRatePercent ?? 0
  const costAnnual = input.costGrowthRatePercent ?? input.growthRatePercent ?? 0
  const revG = revAnnual / 100 / 12
  const costG = costAnnual / 100 / 12
  const disc = input.discountRateAnnual ?? 0.1
  const series = buildMonthlyCashFlowSeriesDualGrowth({
    months: input.durationMonths,
    monthlyRevenue: input.expectedMonthlyRevenue,
    monthlyCosts: input.expectedOperatingCost,
    revenueGrowthRateMonthly: revG,
    costGrowthRateMonthly: costG,
  })
  const nets = series.map(s => s.net)
  const flows = [-input.initialCapital, ...nets]
  const irr = irrMonthlyPercent(flows)
  const npv = npvFromMonthlyFlows(nets, disc)
  const totalProfit = nets.reduce((a, s) => a + s, 0)
  const roi = simpleRoiPercent(totalProfit, input.initialCapital)
  const breakEvenMonth =
    input.initialCapital > 0 ? estimatePaybackMonthsFromSeries(nets, input.initialCapital) : input.durationMonths

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
