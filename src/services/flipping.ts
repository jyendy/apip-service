import type { Asset, CostFact, FlipDueDiligenceItem, FlipProject, FlipRehab, FlipRehabCategory } from '../domain/types'
import { newId } from '../lib/ids'
import * as repo from '../repositories/core-repository'
import * as flipRepo from '../repositories/flipping-repository'

export const DEFAULT_DUE_DILIGENCE_ITEMS: Array<{ name: string; description?: string }> = [
  { name: 'Title Review', description: 'Revisión de título de propiedad' },
  { name: 'Liens', description: 'Gravámenes y cargas' },
  { name: 'Property Taxes', description: 'Impuestos prediales' },
  { name: 'HOA Verification', description: 'Verificación de HOA' },
  { name: 'Structural Inspection', description: 'Inspección estructural' },
  { name: 'Electrical Inspection', description: 'Inspección eléctrica' },
  { name: 'Plumbing Inspection', description: 'Inspección de plomería' },
  { name: 'Roof Inspection', description: 'Inspección de techo' },
  { name: 'Budget Approved', description: 'Presupuesto de rehab aprobado' },
  { name: 'Financing Approved', description: 'Financiamiento aprobado' },
]

export function rehabCategoryToCostCategory(category: FlipRehabCategory): string {
  return category === 'other' ? 'flip_other' : category
}

export function shouldSyncCostFactForRehab(rehab: Pick<FlipRehab, 'amount' | 'status'>): boolean {
  return rehab.amount > 0 && rehab.status !== 'cancelled'
}

export async function ensureFlipProject(
  tenantId: string,
  assetId: string,
  subject?: string,
): Promise<FlipProject> {
  const existing = await flipRepo.getFlipProject(tenantId, assetId)
  if (existing) return existing

  const now = new Date().toISOString()
  const project: FlipProject = {
    assetId,
    tenantId,
    workflowStatus: 'review',
    workflowUpdatedAt: now,
    workflowUpdatedBy: subject,
    createdAt: now,
    updatedAt: now,
  }
  await flipRepo.putFlipProject(project)
  await seedDefaultDueDiligence(tenantId, assetId)
  return project
}

export async function seedDefaultDueDiligence(tenantId: string, assetId: string): Promise<void> {
  const existing = await flipRepo.listFlipDueDiligenceItems(tenantId, assetId)
  if (existing.length > 0) return

  const now = new Date().toISOString()
  await Promise.all(
    DEFAULT_DUE_DILIGENCE_ITEMS.map((item, index) => {
      const dd: FlipDueDiligenceItem = {
        id: newId.flipDueDiligence(),
        tenantId,
        assetId,
        name: item.name,
        description: item.description,
        completed: false,
        sortOrder: index,
        createdAt: now,
        updatedAt: now,
      }
      return flipRepo.putFlipDueDiligenceItem(dd)
    }),
  )
}

export async function syncRehabCostFact(
  tenantId: string,
  asset: Asset,
  rehab: FlipRehab,
): Promise<FlipRehab> {
  if (!shouldSyncCostFactForRehab(rehab)) {
    return rehab
  }

  const category = rehabCategoryToCostCategory(rehab.category)
  const now = new Date().toISOString()

  if (rehab.costFactId) {
    const facts = await repo.listCostFacts(tenantId, asset.id)
    const existing = facts.find(f => f.id === rehab.costFactId)
    if (existing) {
      const updated: CostFact = {
        ...existing,
        date: rehab.date,
        amount: rehab.amount,
        category,
      }
      await repo.putCostFact(updated)
      return rehab
    }
  }

  const costFactId = newId.fact()
  const cf: CostFact = {
    id: costFactId,
    tenantId,
    assetId: asset.id,
    date: rehab.date,
    amount: rehab.amount,
    category,
    source: 'flipping',
    createdAt: now,
    sourceRef: { kind: 'flip_rehab', id: rehab.id },
  }
  await repo.putCostFact(cf)
  return { ...rehab, costFactId, updatedAt: now }
}

export function assertFlipAsset(asset: Asset): void {
  if (asset.type !== 'flip') {
    throw new Error('ASSET_NOT_FLIP')
  }
}
