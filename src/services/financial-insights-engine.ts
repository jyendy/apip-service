import jexl from 'jexl'
import type {
  Asset,
  AssetFinancialMetricsPackage,
  FinancialInsight,
  FinancialInsightInput,
  InsightRule,
} from '../domain/types'

const MAX_INSIGHTS = 5

const severityOrder: Record<FinancialInsight['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
}

export function buildFinancialInsightInput(
  asset: Asset,
  pkg: AssetFinancialMetricsPackage,
): FinancialInsightInput {
  const assetM = pkg.metrics.asset
  const equityM = pkg.metrics.equity
  const flows = assetM.cashFlow
  const n = Math.max(flows.length, 1)
  let sumOp = 0
  for (const p of flows) {
    const op = p.operatingNetCashFlow ?? p.netCashFlow
    sumOp += op
  }
  const avgOperatingCashFlow = sumOp / n

  let avgDebtService = 0
  if (equityM && equityM.cashFlow.length > 0) {
    let sumD = 0
    for (const p of equityM.cashFlow) {
      sumD += p.debtService ?? 0
    }
    avgDebtService = sumD / equityM.cashFlow.length
  }

  const durationMonths =
    asset.financialModel?.durationMonths ?? assetM.coverage.totalMonths ?? assetM.cashFlow.length

  return {
    assetMetrics: {
      roi: assetM.roi,
      irr: assetM.irr,
      npv: assetM.npv,
      payback: assetM.paybackPeriodMonths,
    },
    equityMetrics: equityM
      ? {
          roi: equityM.roi,
          irr: equityM.irr,
          npv: equityM.npv,
          payback: equityM.paybackPeriodMonths,
        }
      : undefined,
    avgOperatingCashFlow,
    avgDebtService,
    durationMonths,
  }
}

function jexlContext(input: FinancialInsightInput, view: 'asset' | 'equity'): Record<string, number> {
  const am = input.assetMetrics
  const em = input.equityMetrics
  const slice = view === 'equity' && em ? em : am
  const equityIRR = em !== undefined ? em.irr : am.irr
  return {
    roi: slice.roi,
    irr: slice.irr,
    npv: slice.npv,
    payback: slice.payback,
    assetIRR: am.irr,
    equityIRR,
    avgOperatingCashFlow: input.avgOperatingCashFlow,
    avgDebtService: input.avgDebtService,
    durationMonths: input.durationMonths,
  }
}

function ruleAppliesToView(rule: InsightRule, view: 'asset' | 'equity'): boolean {
  if (rule.scope === 'both') return true
  return rule.scope === view
}

function evalCondition(condition: string, ctx: Record<string, number>): boolean {
  const trimmed = condition.trim()
  if (!trimmed) return false
  try {
    const v = jexl.evalSync(trimmed, ctx) as unknown
    return Boolean(v)
  } catch {
    return false
  }
}

/**
 * Evalúa reglas activas desde base de datos; sin mensajes embebidos en código de aplicación.
 */
export function generateFinancialInsights(
  rules: InsightRule[],
  input: FinancialInsightInput,
  view: 'asset' | 'equity',
): FinancialInsight[] {
  if (view === 'equity' && !input.equityMetrics) return []

  const ctx = jexlContext(input, view)
  const active = rules.filter(r => r.isActive && ruleAppliesToView(r, view))
  const out: FinancialInsight[] = []

  for (const rule of active) {
    if (!evalCondition(rule.condition, ctx)) continue
    out.push({
      severity: rule.severity,
      message: rule.message,
      recommendation: rule.recommendation,
      priority: rule.priority,
    })
  }

  out.sort((a, b) => {
    const s = severityOrder[a.severity] - severityOrder[b.severity]
    if (s !== 0) return s
    return a.priority - b.priority
  })

  return out.slice(0, MAX_INSIGHTS)
}
