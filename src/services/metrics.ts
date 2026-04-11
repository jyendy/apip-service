import { costCategoryToBucket } from '../domain/cost-categories'
import type {
  Asset,
  AssetFinancialModel,
  AssetMetricsComputed,
  CashFlowPoint,
  CostFact,
  MetricsCoverage,
  MetricsDataMode,
  RevenueFact,
} from '../domain/types'
import {
  CALCULATION_VERSION,
  estimatePaybackMonthsFromSeries,
  irrMonthlyPercent,
  npvFromMonthlyFlows,
  simpleRoiPercent,
} from '../financial/engine'

function monthKey(isoDate: string): string {
  const d = new Date(isoDate)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

function addMonthsYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = Date.UTC(y, m - 1 + delta, 1)
  const y2 = new Date(d).getUTCFullYear()
  const m2 = new Date(d).getUTCMonth() + 1
  return `${y2}-${String(m2).padStart(2, '0')}`
}

function monthsBetweenYm(startYm: string, endYm: string): number {
  const [ys, ms] = startYm.split('-').map(Number)
  const [ye, me] = endYm.split('-').map(Number)
  return (ye - ys) * 12 + (me - ms)
}

type MonthActual = {
  rev: number
  direct: number
  operational: number
  maintenance: number
  depreciation: number
  other: number
}

function buildActualByMonth(revenue: RevenueFact[], costs: CostFact[]): Map<string, MonthActual> {
  const m = new Map<string, MonthActual>()
  const row = (k: string): MonthActual => {
    let r = m.get(k)
    if (!r) {
      r = { rev: 0, direct: 0, operational: 0, maintenance: 0, depreciation: 0, other: 0 }
      m.set(k, r)
    }
    return r
  }
  for (const r of revenue) {
    const k = monthKey(r.date)
    row(k).rev += r.amount
  }
  for (const c of costs) {
    const k = monthKey(c.date)
    const x = row(k)
    const bucket = costCategoryToBucket(c.category)
    if (bucket === 'direct') x.direct += c.amount
    else if (bucket === 'operational') x.operational += c.amount
    else if (bucket === 'maintenance') x.maintenance += c.amount
    else if (bucket === 'depreciation') x.depreciation += c.amount
    else x.other += c.amount
  }
  return m
}

function lastYmWithFacts(actualByMonth: Map<string, MonthActual>): string | null {
  const keys = [...actualByMonth.keys()].sort()
  return keys.length ? keys[keys.length - 1]! : null
}

function projectedRevCost(model: AssetFinancialModel, monthIndex: number): { rev: number; cost: number } {
  const revG = (model.revenueGrowthRate ?? 0) / 100 / 12
  const costG = (model.costGrowthRate ?? 0) / 100 / 12
  const gRev = Math.pow(1 + revG, monthIndex)
  const gCost = Math.pow(1 + costG, monthIndex)
  return {
    rev: model.estimatedMonthlyRevenue * gRev,
    cost: model.estimatedMonthlyCost * gCost,
  }
}

function emptyMetrics(asset: Asset): AssetMetricsComputed {
  const coverage: MetricsCoverage = { actualMonths: 0, projectedMonths: 0, totalMonths: 0 }
  return {
    assetId: asset.id,
    initialInvestment: asset.initialInvestment,
    accumulatedRevenue: 0,
    totalCosts: 0,
    operatingCosts: 0,
    ebitda: 0,
    netProfit: 0,
    roi: 0,
    irr: 0,
    paybackPeriodMonths: 0,
    npv: 0,
    cashFlow: [],
    dataMode: 'SIMULATION',
    coverage,
    calculationVersion: CALCULATION_VERSION,
  }
}

/**
 * Motor híbrido: simulación (`financialModel`) + hechos (`RevenueFact`/`CostFact`).
 * ROI/IRR y agregados se derivan de la serie mensual unificada (fuente de verdad en backend).
 */
export function computeAssetMetrics(
  asset: Asset,
  revenue: RevenueFact[],
  costs: CostFact[],
): AssetMetricsComputed {
  const actualByMonth = buildActualByMonth(revenue, costs)
  const acqYm = monthKey(asset.acquisitionDate)
  const model = asset.financialModel
  const modelMonths = model?.durationMonths ?? 0

  const lastFactYm = lastYmWithFacts(actualByMonth)
  const spanFromFacts = lastFactYm !== null ? monthsBetweenYm(acqYm, lastFactYm) + 1 : 0

  const totalMonths = Math.max(modelMonths, spanFromFacts)

  if (totalMonths === 0) {
    return emptyMetrics(asset)
  }

  let accumulatedRevenue = 0
  let directCostsTotal = 0
  let operationalCostsTotal = 0
  let maintenanceTotal = 0
  let depreciationTotal = 0
  let otherCostsTotal = 0

  let actualMonths = 0
  let projectedMonths = 0

  const nets: number[] = []
  const cashFlow: CashFlowPoint[] = []
  let cumulative = 0

  for (let i = 0; i < totalMonths; i++) {
    const ym = addMonthsYm(acqYm, i)
    const act = actualByMonth.get(ym)
    const hasActual = act !== undefined

    let revM: number
    let directM: number
    let opM: number
    let maintM: number
    let depM: number
    let otherM: number
    let mode: 'ACTUAL' | 'PROJECTED'

    if (hasActual) {
      mode = 'ACTUAL'
      actualMonths++
      revM = act!.rev
      directM = act!.direct
      opM = act!.operational
      maintM = act!.maintenance
      depM = act!.depreciation
      otherM = act!.other
    } else if (model) {
      mode = 'PROJECTED'
      projectedMonths++
      const p = projectedRevCost(model, i)
      revM = p.rev
      const c = p.cost
      directM = 0
      opM = c
      maintM = 0
      depM = 0
      otherM = 0
    } else {
      mode = 'PROJECTED'
      projectedMonths++
      revM = 0
      directM = 0
      opM = 0
      maintM = 0
      depM = 0
      otherM = 0
    }

    const costM = directM + opM + maintM + depM + otherM
    const netM = revM - costM

    accumulatedRevenue += revM
    directCostsTotal += directM
    operationalCostsTotal += opM
    maintenanceTotal += maintM
    depreciationTotal += depM
    otherCostsTotal += otherM

    nets.push(netM)
    cumulative += netM
    cashFlow.push({
      date: `${ym}-01T00:00:00.000Z`,
      revenue: revM,
      costs: costM,
      netCashFlow: netM,
      cumulativeCashFlow: cumulative,
      mode,
    })
  }

  const totalCosts =
    directCostsTotal + operationalCostsTotal + maintenanceTotal + depreciationTotal + otherCostsTotal
  const ebitda =
    accumulatedRevenue - directCostsTotal - operationalCostsTotal - maintenanceTotal
  const netProfit = nets.reduce((a, b) => a + b, 0)

  const operatingCostsField = operationalCostsTotal + maintenanceTotal + depreciationTotal

  const roi = simpleRoiPercent(netProfit, asset.initialInvestment)
  const flowsForIrr = [-asset.initialInvestment, ...nets]
  const irr = nets.length ? irrMonthlyPercent(flowsForIrr) : 0
  const npv = nets.length ? npvFromMonthlyFlows(nets, 0.1) : 0
  const paybackPeriodMonths = nets.length
    ? estimatePaybackMonthsFromSeries(nets, asset.initialInvestment)
    : 0

  let dataMode: MetricsDataMode
  if (actualMonths === 0) dataMode = 'SIMULATION'
  else if (projectedMonths === 0) dataMode = 'ACTUAL'
  else dataMode = 'HYBRID'

  const coverage: MetricsCoverage = {
    actualMonths,
    projectedMonths,
    totalMonths,
  }

  return {
    assetId: asset.id,
    initialInvestment: asset.initialInvestment,
    accumulatedRevenue,
    totalCosts,
    operatingCosts: operatingCostsField,
    ebitda,
    netProfit,
    roi,
    irr,
    paybackPeriodMonths,
    npv,
    cashFlow,
    dataMode,
    coverage,
    calculationVersion: CALCULATION_VERSION,
  }
}
