import type { InsightRule } from '../domain/types'

const now = () => new Date().toISOString()

/** Reglas iniciales del catálogo global (solo usadas al sembrar DynamoDB si está vacío). */
export function defaultPlatformInsightRules(createdAt = now()): InsightRule[] {
  return [
    {
      id: 'fin_irr_neg_roi_pos',
      name: 'TIR negativa con ROI positivo',
      description: 'Detecta rentabilidad contable pero perfil de caja desfavorable.',
      severity: 'critical',
      scope: 'both',
      condition: 'roi > 0 && irr < 0',
      message:
        'Hay ganancia sobre el capital aportado, pero el calendario de cobros hace que la tasa interna de retorno sea negativa.',
      recommendation: 'Revisa plazos de cobro, refinanciación o el enganche frente al costo de la deuda.',
      priority: 1,
      isActive: true,
      createdAt,
    },
    {
      id: 'fin_debt_not_covered',
      name: 'Flujo operativo no cubre la deuda',
      severity: 'critical',
      scope: 'equity',
      condition: 'avgOperatingCashFlow < avgDebtService',
      message:
        'El flujo operativo promedio no alcanza para cubrir el servicio de la deuda en el horizonte analizado.',
      recommendation: 'Revisa ingresos, costos o renegocia tasa/plazo del crédito antes de asumir más apalancamiento.',
      priority: 1,
      isActive: true,
      createdAt,
    },
    {
      id: 'fin_negative_leverage',
      name: 'Apalancamiento negativo',
      severity: 'warning',
      scope: 'equity',
      condition: 'equityIRR < assetIRR',
      message: 'La deuda está reduciendo el rendimiento para el inversionista frente a la vista sin deuda.',
      recommendation: 'Compara tasa del préstamo con el retorno del activo; puede convenir menos deuda o mejores términos.',
      priority: 2,
      isActive: true,
      createdAt,
    },
    {
      id: 'fin_positive_leverage',
      name: 'Apalancamiento positivo',
      severity: 'positive',
      scope: 'equity',
      condition: 'equityIRR > assetIRR',
      message: 'El uso de deuda mejora el rendimiento del capital propio frente al activo sin apalancar.',
      priority: 3,
      isActive: true,
      createdAt,
    },
    {
      id: 'fin_long_payback',
      name: 'Recuperación fuera del horizonte',
      severity: 'warning',
      scope: 'both',
      condition: 'payback >= durationMonths',
      message: 'Con los flujos proyectados, la inversión no se recupera dentro del horizonte de análisis.',
      recommendation: 'Ajusta supuestos de ingreso/costo o amplía el plazo útil considerado en el modelo.',
      priority: 2,
      isActive: true,
      createdAt,
    },
  ]
}
