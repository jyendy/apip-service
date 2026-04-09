import type { AssetMetricsComputed, Insight } from '../domain/types'
import { newId } from '../lib/ids'

const RULE_UNDERPERFORM_ROI = 'RULE_UNDERPERFORM_ROI'

export function buildInsights(
  tenantId: string,
  assets: { id: string; name: string; metrics: AssetMetricsComputed }[],
): Insight[] {
  const out: Insight[] = []
  const threshold = 1.0
  const bad = assets.filter(a => a.metrics.roi < threshold)
  if (bad.length > 0) {
    out.push({
      id: newId.insight(),
      tenantId,
      scope: 'tenant',
      severity: bad.length > 2 ? 'warning' : 'info',
      title: 'Activos por debajo del umbral de ROI',
      body: `${bad.length} activo(s) con ROI < ${threshold}%: ${bad.map(b => b.name).join(', ')}`,
      ruleId: RULE_UNDERPERFORM_ROI,
      assetIds: bad.map(b => b.id),
      generatedAt: new Date().toISOString(),
    })
  }
  return out
}
