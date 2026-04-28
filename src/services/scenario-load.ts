import type { Asset, Scenario } from '../domain/types'
import { newId } from '../lib/ids'
import * as repo from '../repositories/core-repository'
import {
  actualScenarioIdByProject,
  assertSimulatedScenarioForMetrics,
  filterAssetsForProjectScenario,
  filterAssetsTenantActual,
  isAssetActualForProject,
  parseFinancialScenarioQuery,
} from './scenario-metrics'

export type FinancialScenarioMeta = {
  scenario: string
  scenarioId?: string
  /** Proyecto cuyos activos entran en el agregado (simulated/combined en dashboard). */
  scopedProjectId?: string
}

export type LoadAssetsForScenarioResult =
  | { ok: false; message: string }
  | { ok: true; assets: Asset[]; meta: FinancialScenarioMeta }

export async function loadTenantAssetsForExecutiveDashboard(
  tenantId: string,
  params: Record<string, string | undefined> | null,
): Promise<LoadAssetsForScenarioResult> {
  const parsed = parseFinancialScenarioQuery(params)
  if (!parsed.ok) return { ok: false, message: parsed.message }

  const all = await repo.listAssetsByTenant(tenantId, {})

  if (parsed.value.mode === 'actual') {
    const scenarios = await repo.listAllScenariosForTenant(tenantId)
    const map = actualScenarioIdByProject(scenarios)
    const assets = filterAssetsTenantActual(all, map)
    return { ok: true, assets, meta: { scenario: 'actual' } }
  }

  const scenario = await repo.getScenario(tenantId, parsed.value.scenarioId)
  if (!assertSimulatedScenarioForMetrics(scenario, parsed.value.scenarioId)) {
    return { ok: false, message: 'Escenario simulado no encontrado o inválido' }
  }

  const scenarios = await repo.listScenariosByProject(tenantId, scenario.projectId)
  const actId = scenarios.find(s => s.type === 'actual')?.id
  const inProject = all.filter(a => a.projectId === scenario.projectId)
  const assets = filterAssetsForProjectScenario(
    inProject,
    parsed.value.mode,
    parsed.value.scenarioId,
    actId,
  )
  return {
    ok: true,
    assets,
    meta: {
      scenario: parsed.value.mode,
      scenarioId: parsed.value.scenarioId,
      scopedProjectId: scenario.projectId,
    },
  }
}

export async function loadProjectAssetsForScenarioMetrics(
  tenantId: string,
  projectId: string,
  params: Record<string, string | undefined> | null,
): Promise<LoadAssetsForScenarioResult> {
  const parsed = parseFinancialScenarioQuery(params)
  if (!parsed.ok) return { ok: false, message: parsed.message }

  const all = await repo.listAssetsByTenant(tenantId, { projectId })
  const scenarios = await repo.listScenariosByProject(tenantId, projectId)
  const actId = scenarios.find(s => s.type === 'actual')?.id

  if (parsed.value.mode === 'actual') {
    const assets = all.filter(a => isAssetActualForProject(a, actId))
    return { ok: true, assets, meta: { scenario: 'actual' } }
  }

  const scenario = await repo.getScenario(tenantId, parsed.value.scenarioId)
  if (!scenario || scenario.projectId !== projectId) {
    return { ok: false, message: 'scenarioId no pertenece a este proyecto' }
  }
  if (!assertSimulatedScenarioForMetrics(scenario, parsed.value.scenarioId)) {
    return { ok: false, message: 'Se requiere un escenario de tipo simulated' }
  }

  const assets = filterAssetsForProjectScenario(all, parsed.value.mode, scenario.id, actId)
  return {
    ok: true,
    assets,
    meta: {
      scenario: parsed.value.mode,
      scenarioId: scenario.id,
      scopedProjectId: projectId,
    },
  }
}

export async function resolveScenarioIdForAssetWrite(
  tenantId: string,
  portfolioId: string,
  projectId: string,
  scenarioId: string | null | undefined,
): Promise<
  { ok: true; scenarioId: string | undefined } | { ok: false; message: string }
> {
  if (scenarioId === undefined) return { ok: true, scenarioId: undefined }
  if (scenarioId === null || scenarioId === '') {
    return { ok: true, scenarioId: undefined }
  }
  const s = await repo.getScenario(tenantId, scenarioId)
  if (!s) return { ok: false, message: 'scenarioId no encontrado' }
  if (s.portfolioId !== portfolioId || s.projectId !== projectId) {
    return { ok: false, message: 'El escenario no pertenece a este proyecto/portfolio' }
  }
  return { ok: true, scenarioId: s.id }
}

export async function ensureDefaultActualScenarioForProject(params: {
  tenantId: string
  portfolioId: string
  projectId: string
  createdBy: string | undefined
}): Promise<void> {
  const existing = await repo.listScenariosByProject(params.tenantId, params.projectId)
  if (existing.some(s => s.type === 'actual')) return
  const now = new Date().toISOString()
  const s: Scenario = {
    id: newId.scenario(),
    tenantId: params.tenantId,
    portfolioId: params.portfolioId,
    projectId: params.projectId,
    name: 'Actual',
    type: 'actual',
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy ?? 'system',
  }
  await repo.putScenario(s)
}
