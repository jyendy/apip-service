import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { RequestContext } from '../auth/context'
import { requireRbac } from '../auth/require-rbac'
import {
  createVendorBody,
  createFlipDueDiligenceBody,
  createFlipRehabBody,
  patchFlipDueDiligenceBody,
  patchFlipProjectBody,
  patchFlipRehabBody,
  patchFlipWorkflowBody,
  patchVendorBody,
  putFlipProjectBody,
} from '../domain/schemas'
import type { RbacState } from '../domain/rbac'
import type { Asset, FlipDueDiligenceItem, FlipProject, FlipRehab, Vendor } from '../domain/types'
import { auditedJsonError, finalizeAudit } from '../lib/audit'
import { json } from '../lib/http'
import { newId } from '../lib/ids'
import * as repo from '../repositories/core-repository'
import * as flipRepo from '../repositories/flipping-repository'
import * as vendorsRepo from '../repositories/vendors-repository'
import {
  assertFlipAsset,
  ensureFlipProject,
  FLIP_PURCHASE_TYPES,
  FLIP_REHAB_CATEGORIES,
  persistFlipProjectWithSaleSync,
  syncRehabCostFact,
} from '../services/flipping'

function flipValidationError(code: string): string {
  if (code === 'SALE_PRICE_REQUIRED') return 'Precio de venta requerido para cerrar como vendido'
  if (code === 'SALE_DATE_REQUIRED') return 'Fecha real de venta requerida para cerrar como vendido'
  return 'Validación de venta inválida'
}

async function saveFlipProject(
  ctx: RequestContext,
  event: APIGatewayProxyEventV2,
  asset: Asset,
  project: FlipProject,
): Promise<APIGatewayProxyResultV2> {
  try {
    const saved = await persistFlipProjectWithSaleSync(ctx.tenantId, asset, project)
    return finalizeAudit(ctx, event, json(200, { project: saved, asset }))
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'SALE_PRICE_REQUIRED' || code === 'SALE_DATE_REQUIRED') {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', flipValidationError(code))
    }
    throw e
  }
}

async function saveFlipProjectWorkflow(
  ctx: RequestContext,
  event: APIGatewayProxyEventV2,
  asset: Asset,
  project: FlipProject,
): Promise<APIGatewayProxyResultV2> {
  try {
    const saved = await persistFlipProjectWithSaleSync(ctx.tenantId, asset, project)
    return finalizeAudit(ctx, event, json(200, { project: saved }))
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'SALE_PRICE_REQUIRED' || code === 'SALE_DATE_REQUIRED') {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', flipValidationError(code))
    }
    throw e
  }
}

function parseBody<T>(raw: string | undefined): T {
  if (!raw) return {} as T
  return JSON.parse(raw) as T
}

async function loadFlipAsset(
  ctx: RequestContext,
  event: APIGatewayProxyEventV2,
  assetId: string,
): Promise<{ ok: true; asset: Asset } | { ok: false; response: APIGatewayProxyResultV2 }> {
  const asset = await repo.getAsset(ctx.tenantId, assetId)
  if (!asset) return { ok: false, response: auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado') }
  if (asset.type !== 'flip') {
    return {
      ok: false,
      response: auditedJsonError(ctx, event, 400, 'VALIDATION', 'Esta operación solo aplica a activos de tipo flip'),
    }
  }
  return { ok: true, asset }
}

export async function tryRouteFlipping(
  ctx: RequestContext,
  event: APIGatewayProxyEventV2,
  method: string,
  seg: string[],
  rbacState: RbacState,
): Promise<APIGatewayProxyResultV2 | null> {
  if (seg[0] !== 'v1') return null

  // Catálogo transversal de proveedores; UI inicial expuesta desde Flipping.
  if (seg[1] === 'vendors' && seg.length === 2) {
    if (method === 'GET') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:read', {})
      if (denied) return denied
      const items = await vendorsRepo.listVendors(ctx.tenantId)
      items.sort((a, b) => a.name.localeCompare(b.name))
      return finalizeAudit(ctx, event, json(200, { items }))
    }
    if (method === 'POST') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:write', {})
      if (denied) return denied
      const body = createVendorBody.safeParse(parseBody(event.body))
      if (!body.success) {
        return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      }
      const now = new Date().toISOString()
      const vendor: Vendor = {
        id: newId.vendor(),
        tenantId: ctx.tenantId,
        ...body.data,
        active: true,
        createdAt: now,
        updatedAt: now,
      }
      await vendorsRepo.putVendor(vendor)
      return finalizeAudit(ctx, event, json(201, vendor))
    }
  }

  if (seg[1] === 'vendors' && seg[2] && seg.length === 3 && method === 'PATCH') {
    const denied = requireRbac(ctx, event, rbacState, 'asset:write', {})
    if (denied) return denied
    const existing = await vendorsRepo.getVendor(ctx.tenantId, seg[2])
    if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
    const body = patchVendorBody.safeParse(parseBody(event.body))
    if (!body.success) {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
    }
    const next: Vendor = { ...existing, ...body.data, updatedAt: new Date().toISOString() }
    await vendorsRepo.putVendor(next)
    return finalizeAudit(ctx, event, json(200, next))
  }

  if (seg[1] !== 'flipping') return null

  // Catálogos de dominio estáticos: única fuente para clientes del módulo.
  if (seg[2] === 'catalogs' && seg.length === 3 && method === 'GET') {
    const denied = requireRbac(ctx, event, rbacState, 'asset:read', {})
    if (denied) return denied
    return finalizeAudit(
      ctx,
      event,
      json(200, { purchaseTypes: FLIP_PURCHASE_TYPES, rehabCategories: FLIP_REHAB_CATEGORIES }),
    )
  }

  if (seg[2] !== 'projects' || !seg[3]) return null

  const assetId = seg[3]
  const loaded = await loadFlipAsset(ctx, event, assetId)
  if (!loaded.ok) return loaded.response
  const { asset } = loaded
  const scope = { portfolioId: asset.portfolioId, projectId: asset.projectId }

  // GET|PUT|PATCH /v1/flipping/projects/{assetId}
  if (seg.length === 4) {
    if (method === 'GET') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:read', scope)
      if (denied) return denied
      const project = await flipRepo.getFlipProject(ctx.tenantId, assetId)
      if (!project) {
        return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto Flipping no iniciado')
      }
      return finalizeAudit(ctx, event, json(200, { project, asset }))
    }
    if (method === 'PUT') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:write', scope)
      if (denied) return denied
      const body = putFlipProjectBody.safeParse(parseBody(event.body))
      if (!body.success) {
        return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      }
      const project = await ensureFlipProject(ctx.tenantId, assetId, ctx.subject)
      const now = new Date().toISOString()
      const next: FlipProject = {
        ...project,
        ...body.data,
        updatedAt: now,
      }
      return saveFlipProject(ctx, event, asset, next)
    }
    if (method === 'PATCH') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:write', scope)
      if (denied) return denied
      const body = patchFlipProjectBody.safeParse(parseBody(event.body))
      if (!body.success) {
        return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      }
      let project = await flipRepo.getFlipProject(ctx.tenantId, assetId)
      if (!project) {
        project = await ensureFlipProject(ctx.tenantId, assetId, ctx.subject)
      }
      const now = new Date().toISOString()
      const next: FlipProject = { ...project, ...body.data, updatedAt: now }
      return saveFlipProject(ctx, event, asset, next)
    }
  }

  // PATCH /v1/flipping/projects/{assetId}/workflow
  if (seg.length === 5 && seg[4] === 'workflow' && method === 'PATCH') {
    const denied = requireRbac(ctx, event, rbacState, 'asset:write', scope)
    if (denied) return denied
    const body = patchFlipWorkflowBody.safeParse(parseBody(event.body))
    if (!body.success) {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
    }
    let project = await flipRepo.getFlipProject(ctx.tenantId, assetId)
    if (!project) {
      project = await ensureFlipProject(ctx.tenantId, assetId, ctx.subject)
    }
    const transitionAt = body.data.transitionDate ?? new Date().toISOString()
    const next: FlipProject = {
      ...project,
      workflowStatus: body.data.workflowStatus,
      workflowUpdatedAt: transitionAt,
      workflowUpdatedBy: ctx.subject,
      workflowComment: body.data.comment,
      updatedAt: new Date().toISOString(),
      ...(body.data.salePrice !== undefined ? { salePrice: body.data.salePrice } : {}),
      ...(body.data.workflowStatus === 'sold' && !project.actualSaleDate
        ? { actualSaleDate: transitionAt }
        : {}),
    }
    return saveFlipProjectWorkflow(ctx, event, asset, next)
  }

  // /v1/flipping/projects/{assetId}/due-diligence
  if (seg.length === 5 && seg[4] === 'due-diligence') {
    if (method === 'GET') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:read', scope)
      if (denied) return denied
      let items = await flipRepo.listFlipDueDiligenceItems(ctx.tenantId, assetId)
      if (items.length === 0) {
        await ensureFlipProject(ctx.tenantId, assetId, ctx.subject)
        items = await flipRepo.listFlipDueDiligenceItems(ctx.tenantId, assetId)
      }
      items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
      return finalizeAudit(ctx, event, json(200, { items }))
    }
    if (method === 'POST') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:write', scope)
      if (denied) return denied
      await ensureFlipProject(ctx.tenantId, assetId, ctx.subject)
      const body = createFlipDueDiligenceBody.safeParse(parseBody(event.body))
      if (!body.success) {
        return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      }
      const now = new Date().toISOString()
      const item: FlipDueDiligenceItem = {
        id: newId.flipDueDiligence(),
        tenantId: ctx.tenantId,
        assetId,
        phase: body.data.phase,
        name: body.data.name,
        notes: body.data.notes,
        completed: false,
        sortOrder: body.data.sortOrder,
        createdAt: now,
        updatedAt: now,
      }
      await flipRepo.putFlipDueDiligenceItem(item)
      return finalizeAudit(ctx, event, json(201, item))
    }
  }

  if (seg.length === 6 && seg[4] === 'due-diligence' && seg[5] && method === 'PATCH') {
    const itemId = seg[5]
    const denied = requireRbac(ctx, event, rbacState, 'asset:write', scope)
    if (denied) return denied
    const existing = await flipRepo.getFlipDueDiligenceItem(ctx.tenantId, assetId, itemId)
    if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Ítem de due diligence no encontrado')
    const body = patchFlipDueDiligenceBody.safeParse(parseBody(event.body))
    if (!body.success) {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
    }
    const now = new Date().toISOString()
    const completed = body.data.completed ?? existing.completed
    const next: FlipDueDiligenceItem = {
      ...existing,
      ...body.data,
      completed,
      completedAt: completed ? (existing.completedAt ?? now) : undefined,
      completedBy: completed ? (existing.completedBy ?? ctx.subject) : undefined,
      updatedAt: now,
    }
    if (!completed) {
      next.completedAt = undefined
      next.completedBy = undefined
    }
    await flipRepo.putFlipDueDiligenceItem(next)
    return finalizeAudit(ctx, event, json(200, next))
  }

  // /v1/flipping/projects/{assetId}/rehabs
  if (seg.length === 5 && seg[4] === 'rehabs') {
    if (method === 'GET') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:read', scope)
      if (denied) return denied
      const items = await flipRepo.listFlipRehabs(ctx.tenantId, assetId)
      items.sort((a, b) => b.date.localeCompare(a.date))
      return finalizeAudit(ctx, event, json(200, { items }))
    }
    if (method === 'POST') {
      const denied = requireRbac(ctx, event, rbacState, 'asset:write', scope)
      if (denied) return denied
      await ensureFlipProject(ctx.tenantId, assetId, ctx.subject)
      const body = createFlipRehabBody.safeParse(parseBody(event.body))
      if (!body.success) {
        return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      }
      const now = new Date().toISOString()
      const vendor = body.data.vendorId
        ? await vendorsRepo.getVendor(ctx.tenantId, body.data.vendorId)
        : null
      if (body.data.vendorId && (!vendor || !vendor.active)) {
        return auditedJsonError(ctx, event, 400, 'VALIDATION', 'vendorId no existe o está inactivo')
      }
      let rehab: FlipRehab = {
        id: newId.flipRehab(),
        tenantId: ctx.tenantId,
        assetId,
        date: body.data.date,
        category: body.data.category,
        description: body.data.description,
        vendorId: vendor?.id,
        vendorName: vendor?.name,
        amount: body.data.amount,
        status: body.data.status,
        notes: body.data.notes,
        phaseId: body.data.phaseId,
        createdAt: now,
        updatedAt: now,
      }
      assertFlipAsset(asset)
      rehab = await syncRehabCostFact(ctx.tenantId, asset, rehab)
      await flipRepo.putFlipRehab(rehab)
      return finalizeAudit(ctx, event, json(201, rehab))
    }
  }

  if (seg.length === 6 && seg[4] === 'rehabs' && seg[5] && method === 'PATCH') {
    const rehabId = seg[5]
    const denied = requireRbac(ctx, event, rbacState, 'asset:write', scope)
    if (denied) return denied
    const existing = await flipRepo.getFlipRehab(ctx.tenantId, assetId, rehabId)
    if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Rehabilitación no encontrada')
    const body = patchFlipRehabBody.safeParse(parseBody(event.body))
    if (!body.success) {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
    }
    const now = new Date().toISOString()
    const vendorId = body.data.vendorId ?? existing.vendorId
    const vendor = vendorId ? await vendorsRepo.getVendor(ctx.tenantId, vendorId) : null
    if (vendorId && (!vendor || !vendor.active)) {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'vendorId no existe o está inactivo')
    }
    let rehab: FlipRehab = {
      ...existing,
      ...body.data,
      vendorId: vendor?.id,
      vendorName: vendor?.name,
      updatedAt: now,
    }
    assertFlipAsset(asset)
    rehab = await syncRehabCostFact(ctx.tenantId, asset, rehab)
    await flipRepo.putFlipRehab(rehab)
    return finalizeAudit(ctx, event, json(200, rehab))
  }

  return null
}
