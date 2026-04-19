import * as repo from '../repositories/core-repository'
import type { DocumentEntityType } from '../domain/types'

export type ResolveScopeResult =
  | { ok: true; portfolioId: string; projectId: string }
  | { ok: false; code: 'ASSET_NOT_FOUND' | 'PORTFOLIO_PROJECT_REQUIRED' | 'PORTFOLIO_NOT_FOUND' | 'PROJECT_INVALID' }

/**
 * Resuelve portfolio/proyecto y valida pertenencia al tenant.
 * Para `asset` y `property`, el entityId es el id de activo en Dynamo.
 */
export async function resolveDocumentScope(
  tenantId: string,
  entityType: DocumentEntityType,
  entityId: string,
  bodyPortfolioId?: string,
  bodyProjectId?: string,
): Promise<ResolveScopeResult> {
  if (entityType === 'asset' || entityType === 'property') {
    const asset = await repo.getAsset(tenantId, entityId)
    if (!asset) return { ok: false, code: 'ASSET_NOT_FOUND' }
    return { ok: true, portfolioId: asset.portfolioId, projectId: asset.projectId }
  }

  if (!bodyPortfolioId || !bodyProjectId) {
    return { ok: false, code: 'PORTFOLIO_PROJECT_REQUIRED' }
  }

  const pf = await repo.getPortfolio(tenantId, bodyPortfolioId)
  if (!pf) return { ok: false, code: 'PORTFOLIO_NOT_FOUND' }

  const pj = await repo.getProject(tenantId, bodyProjectId)
  if (!pj || pj.portfolioId !== bodyPortfolioId) {
    return { ok: false, code: 'PROJECT_INVALID' }
  }

  return { ok: true, portfolioId: bodyPortfolioId, projectId: bodyProjectId }
}
