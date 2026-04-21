import type {
  AssetFinancialMetricsPackage,
  AssetMetricsComputed,
  CashFlowPoint,
  MetricsCoverage,
  MetricsDataMode,
} from '../domain/types'
import { CALCULATION_VERSION, estimatePaybackMonthsFromSeries, irrMonthlyPercent, npvFromMonthlyFlows, simpleRoiPercent } from '../financial/engine'

type AggregationScope = 'project' | 'portfolio' | 'asset_type'
type AggregationView = 'asset' | 'equity'

export type GroupedMetricsResponse = {
  scope: AggregationScope
  scopeId: string
  viewDefault: AggregationView
  assetCount: number
  includedAssetIds: string[]
  excludedAssetIds: string[]
  metrics: {
    asset: AssetMetricsComputed
    equity: AssetMetricsComputed | null
  }
}

type AlignableSeries = {
  assetId: string
  initialInvestment: number
  cashFlow: CashFlowPoint[]
}

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

function pickSeries(pkg: AssetFinancialMetricsPackage, view: AggregationView): AlignableSeries | null {
  const metrics = view === 'asset' ? pkg.metrics.asset : pkg.metrics.equity
  if (!metrics) return null
  return {
    assetId: pkg.assetId,
    initialInvestment: metrics.initialInvestment,
    cashFlow: metrics.cashFlow,
  }
}

function deriveMode(coverage: MetricsCoverage): MetricsDataMode {
  if (coverage.actualMonths > 0 && coverage.projectedMonths > 0) return 'HYBRID'
  if (coverage.actualMonths > 0) return 'ACTUAL'
  return 'SIMULATION'
}

function aggregateView(scopeId: string, rows: AlignableSeries[]): AssetMetricsComputed {
  if (rows.length === 0) {
    return {
      assetId: scopeId,
      initialInvestment: 0,
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
      coverage: { actualMonths: 0, projectedMonths: 0, totalMonths: 0 },
      calculationVersion: CALCULATION_VERSION,
    }
  }

  const startYm = rows
    .map(r => monthKey(r.cashFlow[0]?.date ?? ''))
    .filter(Boolean)
    .sort()[0]!

  let maxIndex = 0
  for (const row of rows) {
    const firstYm = monthKey(row.cashFlow[0]!.date)
    const offset = monthsBetweenYm(startYm, firstYm)
    const localMax = offset + row.cashFlow.length - 1
    if (localMax > maxIndex) maxIndex = localMax
  }

  const months = maxIndex + 1
  const monthBuckets = Array.from({ length: months }, (_, i) => ({
    date: `${addMonthsYm(startYm, i)}-01T00:00:00.000Z`,
    revenue: 0,
    costs: 0,
    net: 0,
    actualSeen: false,
    debtService: 0,
    operatingNet: 0,
  }))

  for (const row of rows) {
    const firstYm = monthKey(row.cashFlow[0]!.date)
    const offset = monthsBetweenYm(startYm, firstYm)
    for (let i = 0; i < row.cashFlow.length; i++) {
      const g = offset + i
      const p = row.cashFlow[i]!
      monthBuckets[g]!.revenue += p.revenue
      monthBuckets[g]!.costs += p.costs
      monthBuckets[g]!.net += p.netCashFlow
      monthBuckets[g]!.debtService += p.debtService ?? 0
      monthBuckets[g]!.operatingNet += p.operatingNetCashFlow ?? p.netCashFlow
      if (p.mode === 'ACTUAL') monthBuckets[g]!.actualSeen = true
    }
  }

  let cumulative = 0
  let actualMonths = 0
  let projectedMonths = 0
  const cashFlow: CashFlowPoint[] = monthBuckets.map(b => {
    cumulative += b.net
    const mode = b.actualSeen ? 'ACTUAL' : 'PROJECTED'
    if (mode === 'ACTUAL') actualMonths++
    else projectedMonths++
    return {
      date: b.date,
      revenue: b.revenue,
      costs: b.costs,
      netCashFlow: b.net,
      cumulativeCashFlow: cumulative,
      mode,
      debtService: b.debtService > 0 ? b.debtService : undefined,
      operatingNetCashFlow: b.debtService > 0 ? b.operatingNet : undefined,
    }
  })

  const initialInvestment = rows.reduce((s, r) => s + r.initialInvestment, 0)
  const nets = cashFlow.map(p => p.netCashFlow)
  const netProfit = nets.reduce((a, b) => a + b, 0)

  return {
    assetId: scopeId,
    initialInvestment,
    accumulatedRevenue: cashFlow.reduce((s, p) => s + p.revenue, 0),
    totalCosts: cashFlow.reduce((s, p) => s + p.costs, 0),
    operatingCosts: cashFlow.reduce((s, p) => s + p.costs, 0),
    ebitda: cashFlow.reduce((s, p) => s + (p.revenue - p.costs), 0),
    netProfit,
    roi: initialInvestment > 0 ? simpleRoiPercent(netProfit, initialInvestment) : 0,
    irr: initialInvestment > 0 && nets.length > 0 ? irrMonthlyPercent([-initialInvestment, ...nets]) : 0,
    paybackPeriodMonths: initialInvestment > 0 && nets.length > 0 ? estimatePaybackMonthsFromSeries(nets, initialInvestment) : 0,
    npv: nets.length > 0 ? npvFromMonthlyFlows(nets, 0.1) : 0,
    cashFlow,
    dataMode: deriveMode({ actualMonths, projectedMonths, totalMonths: cashFlow.length }),
    coverage: { actualMonths, projectedMonths, totalMonths: cashFlow.length },
    calculationVersion: CALCULATION_VERSION,
  }
}

export function aggregateFinancialPackages(
  scope: AggregationScope,
  scopeId: string,
  packages: AssetFinancialMetricsPackage[],
): GroupedMetricsResponse {
  const assetRows = packages.map(p => pickSeries(p, 'asset')).filter((x): x is AlignableSeries => !!x)
  const equityRows = packages.map(p => pickSeries(p, 'equity')).filter((x): x is AlignableSeries => !!x)
  const excludedForEquity = packages.filter(p => !p.metrics.equity).map(p => p.assetId)

  return {
    scope,
    scopeId,
    viewDefault: 'asset',
    assetCount: packages.length,
    includedAssetIds: packages.map(p => p.assetId),
    excludedAssetIds: excludedForEquity,
    metrics: {
      asset: aggregateView(scopeId, assetRows),
      equity: equityRows.length > 0 ? aggregateView(scopeId, equityRows) : null,
    },
  }
}
