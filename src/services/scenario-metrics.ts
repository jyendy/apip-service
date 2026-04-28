import type { Asset, Scenario } from '../domain/types'

export type ScenarioQueryMode = 'actual' | 'simulated' | 'combined'

export type ParsedFinancialScenario =
  | { mode: 'actual' }
  | { mode: 'simulated' | 'combined'; scenarioId: string }

export function parseFinancialScenarioQuery(
  params: Record<string, string | undefined> | null | undefined,
):
  | { ok: true; value: ParsedFinancialScenario }
  | { ok: false; message: string } {
  const raw = (params?.scenario ?? 'actual').toLowerCase()
  if (raw !== 'actual' && raw !== 'simulated' && raw !== 'combined') {
    return { ok: false, message: 'scenario debe ser actual, simulated o combined' }
  }
  if (raw === 'actual') {
    return { ok: true, value: { mode: 'actual' } }
  }
  const sid = params?.scenarioId?.trim()
  if (!sid) {
    return { ok: false, message: 'scenarioId es obligatorio cuando scenario es simulated o combined' }
  }
  return { ok: true, value: { mode: raw as 'simulated' | 'combined', scenarioId: sid } }
}

/** Mapa projectId -> id del escenario `actual` canónico. */
export function actualScenarioIdByProject(scenarios: Scenario[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of scenarios) {
    if (s.type === 'actual') m.set(s.projectId, s.id)
  }
  return m
}

export function isAssetActualForProject(asset: Asset, actualScenarioId: string | undefined): boolean {
  if (asset.scenarioId == null || asset.scenarioId === '') return true
  if (!actualScenarioId) return true
  return asset.scenarioId === actualScenarioId
}

export function filterAssetsTenantActual(assets: Asset[], actualByProject: Map<string, string>): Asset[] {
  return assets.filter(a => {
    const aid = actualByProject.get(a.projectId)
    return isAssetActualForProject(a, aid)
  })
}

export function filterAssetsForProjectScenario(
  assetsInProject: Asset[],
  mode: ScenarioQueryMode,
  simulatedScenarioId: string,
  actualScenarioId: string | undefined,
): Asset[] {
  if (mode === 'simulated') {
    return assetsInProject.filter(a => a.scenarioId === simulatedScenarioId)
  }
  return assetsInProject.filter(
    a => isAssetActualForProject(a, actualScenarioId) || a.scenarioId === simulatedScenarioId,
  )
}

export type DashboardScenarioContext = {
  parsed: ParsedFinancialScenario
  /** Proyecto asociado al escenario simulado (solo simulated/combined). */
  scopedProjectId?: string
  scenario?: Scenario
}

export function assertSimulatedScenarioForMetrics(
  scenario: Scenario | null,
  scenarioId: string,
): scenario is Scenario {
  return scenario != null && scenario.type === 'simulated' && scenario.id === scenarioId
}
