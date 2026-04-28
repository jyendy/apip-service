import { describe, expect, it } from 'vitest'
import type { Asset, Scenario } from '../domain/types'
import {
  actualScenarioIdByProject,
  filterAssetsForProjectScenario,
  filterAssetsTenantActual,
  isAssetActualForProject,
  parseFinancialScenarioQuery,
} from './scenario-metrics'

function asset(p: Partial<Asset> & Pick<Asset, 'id' | 'projectId'>): Asset {
  return {
    tenantId: 't1',
    portfolioId: 'pf1',
    name: 'A',
    type: 'transport',
    acquisitionDate: '2024-01-01T00:00:00.000Z',
    initialInvestment: 1,
    currency: 'USD',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...p,
  } as Asset
}

describe('parseFinancialScenarioQuery', () => {
  it('default actual', () => {
    const r = parseFinancialScenarioQuery({})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.mode).toBe('actual')
  })
  it('simulated requires scenarioId', () => {
    const r = parseFinancialScenarioQuery({ scenario: 'simulated' })
    expect(r.ok).toBe(false)
  })
  it('simulated ok with id', () => {
    const r = parseFinancialScenarioQuery({ scenario: 'simulated', scenarioId: 'scn_x' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ mode: 'simulated', scenarioId: 'scn_x' })
  })
})

describe('filtering', () => {
  const scenarios: Scenario[] = [
    {
      id: 'act1',
      tenantId: 't1',
      portfolioId: 'pf1',
      projectId: 'p1',
      name: 'Actual',
      type: 'actual',
      createdAt: '',
      updatedAt: '',
      createdBy: 'u',
    },
    {
      id: 'sim1',
      tenantId: 't1',
      portfolioId: 'pf1',
      projectId: 'p1',
      name: 'Plan',
      type: 'simulated',
      createdAt: '',
      updatedAt: '',
      createdBy: 'u',
    },
  ]
  const actMap = actualScenarioIdByProject(scenarios)

  it('isAssetActualForProject', () => {
    expect(isAssetActualForProject(asset({ id: 'a1', projectId: 'p1' }), actMap.get('p1'))).toBe(true)
    expect(isAssetActualForProject(asset({ id: 'a2', projectId: 'p1', scenarioId: 'act1' }), actMap.get('p1'))).toBe(
      true,
    )
    expect(isAssetActualForProject(asset({ id: 'a3', projectId: 'p1', scenarioId: 'sim1' }), actMap.get('p1'))).toBe(
      false,
    )
  })

  it('filterAssetsTenantActual', () => {
    const assets = [
      asset({ id: 'a1', projectId: 'p1' }),
      asset({ id: 'a2', projectId: 'p1', scenarioId: 'sim1' }),
    ]
    const out = filterAssetsTenantActual(assets, actMap)
    expect(out.map(x => x.id)).toEqual(['a1'])
  })

  it('filterAssetsForProjectScenario combined', () => {
    const inProj = [
      asset({ id: 'a1', projectId: 'p1' }),
      asset({ id: 'a2', projectId: 'p1', scenarioId: 'act1' }),
      asset({ id: 'a3', projectId: 'p1', scenarioId: 'sim1' }),
    ]
    const out = filterAssetsForProjectScenario(inProj, 'combined', 'sim1', actMap.get('p1'))
    expect(new Set(out.map(x => x.id))).toEqual(new Set(['a1', 'a2', 'a3']))
  })
})
