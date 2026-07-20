import type {
  Asset,
  CostFact,
  FlipDueDiligenceItem,
  FlipDueDiligencePhase,
  FlipProject,
  FlipProForma,
  FlipRehab,
  FlipRehabCategory,
  RevenueFact,
} from '../domain/types'
import { newId } from '../lib/ids'
import * as repo from '../repositories/core-repository'
import * as flipRepo from '../repositories/flipping-repository'
import { financialModelFromFlipProForma, hasFlipProForma } from './flip-proforma'

export const FLIP_PURCHASE_TYPES = ['mls', 'auction', 'reo', 'short_sale'] as const
export const FLIP_REHAB_CATEGORIES: FlipRehabCategory[] = [
  'kitchen',
  'bathroom',
  'flooring',
  'electrical',
  'plumbing',
  'roof',
  'paint',
  'hvac',
  'landscaping',
  'hoa',
  'dumpster',
  'permits',
  'lawyer',
  'other',
]

export const DEFAULT_DUE_DILIGENCE_ITEMS: Array<{ phase: FlipDueDiligencePhase; name: string }> = [
  { phase: 'review', name: 'Verify Property History' },
  { phase: 'review', name: 'Verify Liens' },
  { phase: 'review', name: 'Verify Property Taxes' },
  { phase: 'budget_analysis', name: 'Request Budget' },
  { phase: 'budget_analysis', name: 'Review Budget' },
  { phase: 'budget_analysis', name: 'Approve Budget' },
  { phase: 'rehab', name: 'Change Orders' },
  { phase: 'listing', name: 'Final Inspection' },
]

export function rehabCategoryToCostCategory(category: FlipRehabCategory): string {
  return category === 'other' ? 'flip_other' : category
}

export function shouldSyncCostFactForRehab(rehab: Pick<FlipRehab, 'amount' | 'status'>): boolean {
  return rehab.amount > 0 && (rehab.status === 'in_progress' || rehab.status === 'completed')
}

export function shouldSyncRevenueFactForSale(
  project: Pick<FlipProject, 'workflowStatus' | 'salePrice' | 'actualSaleDate'>,
): boolean {
  return (
    project.workflowStatus === 'sold' &&
    typeof project.salePrice === 'number' &&
    project.salePrice > 0 &&
    !!project.actualSaleDate
  )
}

export function validateSoldProjectReady(
  project: Pick<FlipProject, 'workflowStatus' | 'salePrice' | 'actualSaleDate'>,
): 'SALE_DATE_REQUIRED' | 'SALE_PRICE_REQUIRED' | null {
  if (project.workflowStatus !== 'sold') return null
  if (!project.actualSaleDate) return 'SALE_DATE_REQUIRED'
  if (!project.salePrice || project.salePrice <= 0) return 'SALE_PRICE_REQUIRED'
  return null
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
        phase: item.phase,
        name: item.name,
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
  const now = new Date().toISOString()

  if (!shouldSyncCostFactForRehab(rehab)) {
    if (rehab.costFactId) {
      await repo.deleteCostFact(tenantId, asset.id, rehab.costFactId)
      const { costFactId: _removed, ...rest } = rehab
      return { ...rest, updatedAt: now }
    }
    return rehab
  }

  const category = rehabCategoryToCostCategory(rehab.category)

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

export async function syncSaleRevenueFact(
  tenantId: string,
  asset: Asset,
  project: FlipProject,
): Promise<FlipProject> {
  const now = new Date().toISOString()

  if (!shouldSyncRevenueFactForSale(project)) {
    if (project.revenueFactId) {
      await repo.deleteRevenueFact(tenantId, asset.id, project.revenueFactId)
      const { revenueFactId: _removed, ...rest } = project
      return { ...rest, updatedAt: now }
    }
    return project
  }

  const saleDate = project.actualSaleDate!

  if (project.revenueFactId) {
    const facts = await repo.listRevenueFacts(tenantId, asset.id)
    const existing = facts.find(f => f.id === project.revenueFactId)
    if (existing) {
      const updated: RevenueFact = {
        ...existing,
        date: saleDate,
        amount: project.salePrice!,
        category: 'flip_sale',
      }
      await repo.putRevenueFact(updated)
      return project
    }
  }

  const revenueFactId = newId.fact()
  const rf: RevenueFact = {
    id: revenueFactId,
    tenantId,
    assetId: asset.id,
    date: saleDate,
    amount: project.salePrice!,
    category: 'flip_sale',
    source: 'flipping',
    createdAt: now,
    sourceRef: { kind: 'flip_sale', id: project.assetId },
  }
  await repo.putRevenueFact(rf)
  return { ...project, revenueFactId, updatedAt: now }
}

export async function syncAssetFinancialModelFromProForma(
  tenantId: string,
  asset: Asset,
  proForma?: FlipProForma,
): Promise<Asset> {
  if (!proForma || !hasFlipProForma(proForma)) return asset
  const now = new Date().toISOString()
  const updated: Asset = {
    ...asset,
    financialModel: financialModelFromFlipProForma(proForma),
    updatedAt: now,
  }
  await repo.putAsset(updated)
  return updated
}

export async function persistFlipProjectWithSaleSync(
  tenantId: string,
  asset: Asset,
  project: FlipProject,
): Promise<FlipProject> {
  const validation = validateSoldProjectReady(project)
  if (validation) {
    throw new Error(validation)
  }
  const synced = await syncSaleRevenueFact(tenantId, asset, project)
  await flipRepo.putFlipProject(synced)
  if (project.proForma !== undefined) {
    await syncAssetFinancialModelFromProForma(tenantId, asset, project.proForma)
  }
  return synced
}

export function assertFlipAsset(asset: Asset): void {
  if (asset.type !== 'flip') {
    throw new Error('ASSET_NOT_FLIP')
  }
}
