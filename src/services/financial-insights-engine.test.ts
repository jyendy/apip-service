import { describe, expect, it } from 'vitest'
import type { InsightRule } from '../domain/types'
import { generateFinancialInsights } from './financial-insights-engine'

const baseRule = (overrides: Partial<InsightRule>): InsightRule => ({
  id: 'test',
  name: 't',
  severity: 'warning',
  scope: 'both',
  condition: 'true',
  message: 'm',
  priority: 1,
  isActive: true,
  createdAt: new Date().toISOString(),
  ...overrides,
})

describe('generateFinancialInsights', () => {
  it('emite insight crítico cuando ROI > 0 e IRR < 0 (vista activo)', () => {
    const rules: InsightRule[] = [
      baseRule({
        id: 'r1',
        severity: 'critical',
        scope: 'both',
        condition: 'roi > 0 && irr < 0',
        message: 'TIR negativa con ROI positivo',
        priority: 1,
      }),
    ]
    const input = {
      assetMetrics: { roi: 5, irr: -2, npv: 100, payback: 12 },
      avgOperatingCashFlow: 1000,
      avgDebtService: 0,
      durationMonths: 36,
    }
    const out = generateFinancialInsights(rules, input, 'asset')
    expect(out).toHaveLength(1)
    expect(out[0]?.severity).toBe('critical')
    expect(out[0]?.message).toBe('TIR negativa con ROI positivo')
  })

  it('emite crítico cuando el flujo operativo no cubre la deuda (equity)', () => {
    const rules: InsightRule[] = [
      baseRule({
        id: 'dscr',
        severity: 'critical',
        scope: 'equity',
        condition: 'avgOperatingCashFlow < avgDebtService',
        message: 'Deuda no cubierta',
        priority: 1,
      }),
    ]
    const input = {
      assetMetrics: { roi: 1, irr: 1, npv: 1, payback: 10 },
      equityMetrics: { roi: 1, irr: 1, npv: 1, payback: 10 },
      avgOperatingCashFlow: 100,
      avgDebtService: 200,
      durationMonths: 36,
    }
    const out = generateFinancialInsights(rules, input, 'equity')
    expect(out.some(i => i.message === 'Deuda no cubierta')).toBe(true)
  })

  it('advertencia cuando equityIRR < assetIRR', () => {
    const rules: InsightRule[] = [
      baseRule({
        id: 'lev',
        severity: 'warning',
        scope: 'equity',
        condition: 'equityIRR < assetIRR',
        message: 'Apalancamiento negativo',
        priority: 2,
      }),
    ]
    const input = {
      assetMetrics: { roi: 10, irr: 15, npv: 0, payback: 20 },
      equityMetrics: { roi: 8, irr: 10, npv: 0, payback: 24 },
      avgOperatingCashFlow: 500,
      avgDebtService: 100,
      durationMonths: 36,
    }
    const out = generateFinancialInsights(rules, input, 'equity')
    expect(out.some(i => i.message === 'Apalancamiento negativo')).toBe(true)
  })

  it('advertencia cuando payback >= durationMonths', () => {
    const rules: InsightRule[] = [
      baseRule({
        id: 'pb',
        severity: 'warning',
        scope: 'both',
        condition: 'payback >= durationMonths',
        message: 'Recuperación larga',
        priority: 2,
      }),
    ]
    const input = {
      assetMetrics: { roi: 1, irr: 2, npv: 0, payback: 48 },
      avgOperatingCashFlow: 100,
      avgDebtService: 0,
      durationMonths: 48,
    }
    const out = generateFinancialInsights(rules, input, 'asset')
    expect(out.some(i => i.message === 'Recuperación larga')).toBe(true)
  })

  it('respeta máximo 5 insights y orden por severidad y prioridad', () => {
    const rules: InsightRule[] = Array.from({ length: 8 }, (_, i) =>
      baseRule({
        id: `r${i}`,
        severity: 'info',
        scope: 'both',
        condition: 'true',
        message: `m${i}`,
        priority: i,
      }),
    )
    const input = {
      assetMetrics: { roi: 0, irr: 0, npv: 0, payback: 1 },
      avgOperatingCashFlow: 0,
      avgDebtService: 0,
      durationMonths: 100,
    }
    const out = generateFinancialInsights(rules, input, 'asset')
    expect(out.length).toBe(5)
  })

  it('no evalúa reglas equity sin métricas equity', () => {
    const rules: InsightRule[] = [
      baseRule({
        id: 'eq',
        scope: 'equity',
        condition: 'true',
        message: 'solo equity',
        priority: 1,
      }),
    ]
    const input = {
      assetMetrics: { roi: 1, irr: 1, npv: 1, payback: 1 },
      avgOperatingCashFlow: 1,
      avgDebtService: 0,
      durationMonths: 12,
    }
    expect(generateFinancialInsights(rules, input, 'equity')).toEqual([])
  })
})
