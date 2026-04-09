import type { CostFact } from '../domain/types'
import type { AssetMetricsComputed } from '../domain/types'

export type StructureLine = {
  label: string
  amount: number
  indent: number
  isTotal?: boolean
}

/** Estado financiero estandarizado (prompt: Revenue − costos por categoría = Operating Income). */
export function buildStandardizedStructure(
  metrics: AssetMetricsComputed,
  costs: CostFact[],
): { lines: StructureLine[]; operatingIncome: number } {
  const revenue = metrics.accumulatedRevenue
  const directCosts = costs.filter(c => c.category === 'direct').reduce((s, c) => s + c.amount, 0)
  const operationalCosts = costs.filter(c => c.category === 'operational').reduce((s, c) => s + c.amount, 0)
  const maintenance = costs.filter(c => c.category === 'maintenance').reduce((s, c) => s + c.amount, 0)
  const depreciation = costs.filter(c => c.category === 'depreciation').reduce((s, c) => s + c.amount, 0)
  const operatingIncome = revenue - directCosts - operationalCosts - maintenance - depreciation

  const lines: StructureLine[] = [
    { label: 'Revenue', amount: revenue, indent: 0 },
    { label: '– Direct Costs', amount: -directCosts, indent: 1 },
    { label: '– Operational Costs', amount: -operationalCosts, indent: 1 },
    { label: '– Maintenance', amount: -maintenance, indent: 1 },
    { label: '– Depreciation', amount: -depreciation, indent: 1 },
    { label: '= Operating Income', amount: operatingIncome, indent: 0, isTotal: true },
  ]

  return { lines, operatingIncome }
}
