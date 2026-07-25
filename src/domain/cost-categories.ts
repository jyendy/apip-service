/**
 * Catálogo de categorías de costo para hechos (CostFact) y motor financiero.
 * Cada código mapea a un bucket del motor híbrido (direct / operational / maintenance / depreciation / other).
 */

export type MetricsCostBucket = 'direct' | 'operational' | 'maintenance' | 'depreciation' | 'other'

export type CostCategoryDefinition = {
  code: string
  label: string
  bucket: MetricsCostBucket
}

/** Catálogo extendido: legacy + TMS + operativo general. */
export const COST_CATEGORY_CATALOG: CostCategoryDefinition[] = [
  { code: 'direct', label: 'Directo', bucket: 'direct' },
  { code: 'operational', label: 'Operativo (genérico)', bucket: 'operational' },
  { code: 'maintenance', label: 'Mantenimiento', bucket: 'maintenance' },
  { code: 'depreciation', label: 'Depreciación', bucket: 'depreciation' },
  { code: 'other', label: 'Otro', bucket: 'other' },
  { code: 'fuel', label: 'Combustible', bucket: 'operational' },
  { code: 'tolls', label: 'Peajes', bucket: 'operational' },
  { code: 'driver', label: 'Conductor', bucket: 'operational' },
  { code: 'insurance', label: 'Seguro', bucket: 'other' },
  { code: 'taxes', label: 'Impuestos y tasas', bucket: 'other' },
  { code: 'environmental', label: 'Verificación ambiental', bucket: 'other' },
  { code: 'permits', label: 'Permisos y licencias', bucket: 'other' },
  { code: 'compliance', label: 'Cumplimiento normativo', bucket: 'other' },
  { code: 'leasing', label: 'Arrendamiento de unidad', bucket: 'operational' },
  { code: 'tires', label: 'Llantas y neumáticos', bucket: 'maintenance' },
  { code: 'kitchen', label: 'Cocina', bucket: 'maintenance' },
  { code: 'bathroom', label: 'Baño', bucket: 'maintenance' },
  { code: 'flooring', label: 'Pisos', bucket: 'maintenance' },
  { code: 'electrical', label: 'Eléctrico', bucket: 'maintenance' },
  { code: 'plumbing', label: 'Plomería', bucket: 'maintenance' },
  { code: 'roof', label: 'Techo', bucket: 'maintenance' },
  { code: 'paint', label: 'Pintura', bucket: 'maintenance' },
  { code: 'hvac', label: 'HVAC', bucket: 'maintenance' },
  { code: 'landscaping', label: 'Paisajismo', bucket: 'maintenance' },
  { code: 'hoa', label: 'HOA', bucket: 'operational' },
  { code: 'dumpster', label: 'Contenedor de residuos', bucket: 'maintenance' },
  { code: 'lawyer', label: 'Abogado', bucket: 'other' },
  { code: 'flip_other', label: 'Rehab — otro', bucket: 'maintenance' },
]

const BUCKET_BY_CODE = new Map<string, MetricsCostBucket>(
  COST_CATEGORY_CATALOG.map(d => [d.code, d.bucket]),
)

/** Mapea categoría almacenada en CostFact → bucket del motor de métricas. */
export function costCategoryToBucket(category: string): MetricsCostBucket {
  const b = BUCKET_BY_CODE.get(category)
  if (b) return b
  const lower = category.toLowerCase()
  if (['direct', 'operational', 'maintenance', 'depreciation', 'other'].includes(lower)) {
    return lower as MetricsCostBucket
  }
  return 'other'
}
