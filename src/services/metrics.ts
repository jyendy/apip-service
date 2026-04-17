import { costCategoryToBucket } from '../domain/cost-categories'
import type {
  Asset,
  AssetFinancialModel,
  AssetFinancialMetricsPackage,
  AssetFinancing,
  AssetMetricsComputed,
  CashFlowPoint,
  CostFact,
  MetricsCoverage,
  MetricsDataMode,
  RevenueFact,
} from '../domain/types'
import { buildDebtServiceByMonth, financingPublicSnapshot, generateAmortizationSchedule } from './financing'
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
  if (process.env.APIP_DEBUG_IRR_CASHFLOWS === '1' || process.env.APIP_DEBUG_IRR_CASHFLOWS === 'true') {
    const eps = 1e-6
    const n = Math.min(6, nets.length, cashFlow.length)
    const seriesMatch = Array.from({ length: n }, (_, i) => {
      const fromNet = nets[i]!
      const fromPoint = cashFlow[i]!.netCashFlow
      return {
        monthIndex: i,
        ym: cashFlow[i]!.date.slice(0, 7),
        nets_i: fromNet,
        cashFlow_i_netCashFlow: fromPoint,
        delta: fromNet - fromPoint,
        ok: Math.abs(fromNet - fromPoint) < eps,
      }
    })
    const irrSlotVsUi = Array.from({ length: Math.min(4, nets.length) }, (_, i) => ({
      uiTableRow: `cashFlow[${i}].netCashFlow`,
      value: cashFlow[i]!.netCashFlow,
      irrSeriesIndex: i + 1,
      flowsForIrr_at_irrIndex: flowsForIrr[i + 1]!,
      ok: Math.abs(cashFlow[i]!.netCashFlow - flowsForIrr[i + 1]!) < eps,
    }))
    console.log(
      '[APIP_DEBUG_IRR_CASHFLOWS] computeAssetMetrics %s\nflowsForIrr[0] (t0 CAPEX)=%s\nflowsForIrr.slice(0,5)=%s\nnets vs cashFlow.net (primeros meses)=%s\nalineación UI vs entrada IRR (índice API t+1)=%s',
      asset.id,
      JSON.stringify(flowsForIrr[0]),
      JSON.stringify(flowsForIrr.slice(0, 5)),
      JSON.stringify(seriesMatch),
      JSON.stringify(irrSlotVsUi),
    )
  }
  // TIR anual efectiva (%): Newton + bisección sobre flowsForIrr; ver `irrMonthlyPercent` en `financial/engine.ts`.
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

function financingStartOffsetMonths(acqYm: string, startIso: string): number {
  const startYm = monthKey(startIso)
  if (startYm < acqYm) return 0
  return monthsBetweenYm(acqYm, startYm)
}

/**
 * Métricas del activo (sin deuda) + métricas equity (apalancado) y snapshot de financiamiento.
 * La vista `asset` coincide con `computeAssetMetrics`; la vista `equity` descuenta la cuota del préstamo (no mezclada con costos operativos).
 */
export function computeAssetFinancialPackage(
  asset: Asset,
  revenue: RevenueFact[],
  costs: CostFact[],
  financing: AssetFinancing | null,
): AssetFinancialMetricsPackage {
  const assetM = computeAssetMetrics(asset, revenue, costs)
  if (!financing) {
    return {
      assetId: asset.id,
      calculationVersion: assetM.calculationVersion,
      metrics: { asset: assetM, equity: null },
      financing: null,
    }
  }

  const sumCap = financing.principal + financing.downPayment
  if (Math.abs(sumCap - asset.initialInvestment) > 0.01 * Math.max(asset.initialInvestment, 1)) {
    console.warn('[financing] principal + downPayment no coincide con initialInvestment del activo', {
      assetId: asset.id,
      principal: financing.principal,
      downPayment: financing.downPayment,
      initialInvestment: asset.initialInvestment,
    })
  }

  const schedule = generateAmortizationSchedule(financing)
  const acqYm = monthKey(asset.acquisitionDate)
  const offset = financingStartOffsetMonths(acqYm, financing.startDate)
  const debtByMonth = buildDebtServiceByMonth(assetM.cashFlow.length, offset, schedule)

  const equityNets: number[] = []
  const equityFlow: CashFlowPoint[] = []
  let cumEq = 0
  for (let i = 0; i < assetM.cashFlow.length; i++) {
    const p = assetM.cashFlow[i]!
    const d = debtByMonth[i] ?? 0
    const opNet = p.netCashFlow
    const eqNet = opNet - d
    equityNets.push(eqNet)
    cumEq += eqNet
    equityFlow.push({
      ...p,
      operatingNetCashFlow: opNet,
      debtService: d,
      netCashFlow: eqNet,
      cumulativeCashFlow: cumEq,
    })
  }

  const equityNetProfit = equityNets.reduce((a, b) => a + b, 0)
  const down = financing.downPayment
  const roiEq = down > 0 ? simpleRoiPercent(equityNetProfit, down) : 0
  const flowsEq = down > 0 ? [-down, ...equityNets] : []
  const irrEq = equityNets.length && down > 0 ? irrMonthlyPercent(flowsEq) : 0
  const npvEq = equityNets.length ? npvFromMonthlyFlows(equityNets, 0.1) : 0
  const payEq = down > 0 && equityNets.length ? estimatePaybackMonthsFromSeries(equityNets, down) : 0

  const equityM: AssetMetricsComputed = {
    ...assetM,
    initialInvestment: down,
    netProfit: equityNetProfit,
    roi: roiEq,
    irr: irrEq,
    npv: npvEq,
    paybackPeriodMonths: payEq,
    cashFlow: equityFlow,
  }

  return {
    assetId: asset.id,
    calculationVersion: assetM.calculationVersion,
    metrics: { asset: assetM, equity: equityM },
    financing: financingPublicSnapshot(financing, schedule),
  }
}
