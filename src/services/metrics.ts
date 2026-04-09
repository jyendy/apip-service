import type { Asset, AssetMetricsComputed, CashFlowPoint, CostFact, RevenueFact } from '../domain/types'
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

/** Agrega hechos por mes y construye métricas coherentes con el front (iterable). */
export function computeAssetMetrics(
  asset: Asset,
  revenue: RevenueFact[],
  costs: CostFact[],
): AssetMetricsComputed {
  const accumulatedRevenue = revenue.reduce((s, r) => s + r.amount, 0)
  const directCosts = costs.filter(c => c.category === 'direct').reduce((s, c) => s + c.amount, 0)
  const operationalCosts = costs.filter(c => c.category === 'operational').reduce((s, c) => s + c.amount, 0)
  const maintenance = costs.filter(c => c.category === 'maintenance').reduce((s, c) => s + c.amount, 0)
  const depreciation = costs.filter(c => c.category === 'depreciation').reduce((s, c) => s + c.amount, 0)
  const operatingCostsTotal = operationalCosts + maintenance + depreciation

  const ebitda = accumulatedRevenue - directCosts - operationalCosts - maintenance
  const netProfit = ebitda - depreciation

  const roi = simpleRoiPercent(netProfit, asset.initialInvestment)

  const byMonth = new Map<string, { rev: number; cost: number }>()
  for (const r of revenue) {
    const k = monthKey(r.date)
    const cur = byMonth.get(k) ?? { rev: 0, cost: 0 }
    cur.rev += r.amount
    byMonth.set(k, cur)
  }
  for (const c of costs) {
    const k = monthKey(c.date)
    const cur = byMonth.get(k) ?? { rev: 0, cost: 0 }
    cur.cost += c.amount
    byMonth.set(k, cur)
  }
  const sortedMonths = [...byMonth.keys()].sort()
  const nets: number[] = []
  const cashFlow: CashFlowPoint[] = []
  let cumulative = 0
  for (const k of sortedMonths) {
    const { rev, cost } = byMonth.get(k)!
    const net = rev - cost
    cumulative += net
    nets.push(net)
    cashFlow.push({
      date: `${k}-01T00:00:00.000Z`,
      revenue: rev,
      costs: cost,
      netCashFlow: net,
      cumulativeCashFlow: cumulative,
    })
  }

  const flowsForIrr = [-asset.initialInvestment, ...nets]
  const irr = nets.length ? irrMonthlyPercent(flowsForIrr) : 0
  const npv = nets.length ? npvFromMonthlyFlows(nets, 0.1) : 0
  const paybackPeriodMonths = nets.length
    ? estimatePaybackMonthsFromSeries(nets, asset.initialInvestment)
    : 0

  return {
    assetId: asset.id,
    initialInvestment: asset.initialInvestment,
    accumulatedRevenue,
    operatingCosts: operatingCostsTotal,
    ebitda,
    netProfit,
    roi,
    irr,
    paybackPeriodMonths,
    npv,
    cashFlow,
    calculationVersion: CALCULATION_VERSION,
  }
}
