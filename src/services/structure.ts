import type { CostFact, RevenueFact } from '../domain/types'
import type { AssetMetricsComputed } from '../domain/types'

export type StructureLine = {
  label: string
  amount: number
  indent: number
  isTotal?: boolean
}

/**
 * Estado financiero estandarizado para presentación.
 * Los totales se alinean con `metrics` (motor híbrido); el desglose por categoría refleja hechos donde existan.
 */
export function buildStandardizedStructure(
  metrics: AssetMetricsComputed,
  revenueFacts: RevenueFact[],
  costs: CostFact[],
): { lines: StructureLine[]; operatingIncome: number } {
  const revenue = metrics.accumulatedRevenue
  const directCosts = costs.filter(c => c.category === 'direct').reduce((s, c) => s + c.amount, 0)
  const operationalCosts = costs.filter(c => c.category === 'operational').reduce((s, c) => s + c.amount, 0)
  const maintenance = costs.filter(c => c.category === 'maintenance').reduce((s, c) => s + c.amount, 0)
  const depreciation = costs.filter(c => c.category === 'depreciation').reduce((s, c) => s + c.amount, 0)
  const other = costs.filter(c => c.category === 'other').reduce((s, c) => s + c.amount, 0)

  const revenueFromFacts = revenueFacts.reduce((s, r) => s + r.amount, 0)
  const costFactsTotal = directCosts + operationalCosts + maintenance + depreciation + other
  const totalCostsSeries = metrics.cashFlow.reduce((s, p) => s + p.costs, 0)

  const projectedRevenue = revenue - revenueFromFacts
  const projectedCosts = totalCostsSeries - costFactsTotal

  const lines: StructureLine[] = [{ label: 'Revenue', amount: revenue, indent: 0 }]

  if (metrics.dataMode !== 'ACTUAL' && Math.abs(projectedRevenue) > 1e-6) {
    lines.push({ label: '— reconocido (hechos)', amount: revenueFromFacts, indent: 1 })
    lines.push({ label: '— proyectado (modelo)', amount: projectedRevenue, indent: 1 })
  }

  lines.push(
    { label: '– Direct Costs', amount: -directCosts, indent: 1 },
    { label: '– Operational Costs', amount: -operationalCosts, indent: 1 },
    { label: '– Maintenance', amount: -maintenance, indent: 1 },
    { label: '– Depreciation', amount: -depreciation, indent: 1 },
  )

  if (other !== 0) {
    lines.push({ label: '– Other costs', amount: -other, indent: 1 })
  }

  if (metrics.dataMode !== 'ACTUAL' && Math.abs(projectedCosts) > 1e-6) {
    lines.push({ label: '– proyectado (modelo)', amount: -projectedCosts, indent: 1 })
  }

  const operatingIncome = revenue - totalCostsSeries

  lines.push({ label: '= Operating Income', amount: operatingIncome, indent: 0, isTotal: true })

  return { lines, operatingIncome }
}
