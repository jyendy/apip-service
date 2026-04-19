import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { RequestContext } from '../auth/context'
import { requireRbac } from '../auth/require-rbac'
import { auditedJsonError, finalizeAudit } from '../lib/audit'
import {
  createDocumentBody,
  createDocumentRequirementBody,
  documentRequirementsListQuery,
  documentsListQuery,
  rejectDocumentBody,
} from '../domain/schemas'
import type { RbacState } from '../domain/rbac'
import type { Document, DocumentRequirement } from '../domain/types'
import { json } from '../lib/http'
import { newId } from '../lib/ids'
import {
  buildDocumentObjectKey,
  documentsBucketName,
  headObjectExists,
  presignGetDocument,
  presignPutDocument,
} from '../lib/s3-documents'
import * as docRepo from '../repositories/documents-repository'
import * as repo from '../repositories/core-repository'
import { computeMissingRequiredDocuments } from '../services/document-compliance'
import { resolveDocumentScope } from '../services/document-scope'

function parseBody<T>(raw: string | undefined): T {
  if (!raw) return {} as T
  return JSON.parse(raw) as T
}

function scopeErrorToHttp(
  ctx: RequestContext,
  event: APIGatewayProxyEventV2,
  code: 'ASSET_NOT_FOUND' | 'PORTFOLIO_PROJECT_REQUIRED' | 'PORTFOLIO_NOT_FOUND' | 'PROJECT_INVALID',
): APIGatewayProxyResultV2 {
  const map: Record<typeof code, [number, string, string]> = {
    ASSET_NOT_FOUND: [404, 'NOT_FOUND', 'Activo no encontrado'],
    PORTFOLIO_PROJECT_REQUIRED: [400, 'VALIDATION', 'portfolioId y projectId son obligatorios para este tipo de entidad'],
    PORTFOLIO_NOT_FOUND: [400, 'VALIDATION', 'portfolioId no existe'],
    PROJECT_INVALID: [400, 'VALIDATION', 'projectId no existe o no pertenece al portfolio'],
  }
  const m = map[code]
  return auditedJsonError(ctx, event, m[0], m[1], m[2])
}

export async function tryRouteDocuments(
  ctx: RequestContext,
  event: APIGatewayProxyEventV2,
  method: string,
  seg: string[],
  rbacState: RbacState,
): Promise<APIGatewayProxyResultV2 | null> {
  if (seg[0] !== 'v1') return null

  // --- /v1/document-requirements ---
  if (seg[1] === 'document-requirements' && seg.length === 2) {
    if (method === 'GET') {
      const q = documentRequirementsListQuery.safeParse(event.queryStringParameters ?? {})
      if (!q.success) {
        return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Query inválida', q.error.flatten())
      }
      const denied = requireRbac(ctx, event, rbacState, 'asset:read', {})
      if (denied) return denied
      const items = await docRepo.listDocumentRequirements(ctx.tenantId, q.data.entityType)
      return finalizeAudit(ctx, event, json(200, { items }))
    }
    if (method === 'POST') {
      const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
      if (denied) return denied
      const body = createDocumentRequirementBody.safeParse(parseBody(event.body))
      if (!body.success) {
        return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      }
      const now = new Date().toISOString()
      const req: DocumentRequirement = {
        id: newId.docRequirement(),
        tenantId: ctx.tenantId,
        entityType: body.data.entityType,
        name: body.data.name,
        description: body.data.description,
        required: body.data.required,
        region: body.data.region,
        createdAt: now,
      }
      await docRepo.putDocumentRequirement(req)
      return finalizeAudit(ctx, event, json(201, req))
    }
  }

  if (seg[1] !== 'documents') return null

  const bucket = documentsBucketName()

  // GET /v1/documents?entityType=&entityId=
  if (seg.length === 2 && method === 'GET') {
    const q = documentsListQuery.safeParse(event.queryStringParameters ?? {})
    if (!q.success) {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Query inválida', q.error.flatten())
    }
    let scope: { portfolioId?: string; projectId?: string } = {}
    if (q.data.entityType === 'asset' || q.data.entityType === 'property') {
      const asset = await repo.getAsset(ctx.tenantId, q.data.entityId)
      if (!asset) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
      scope = { portfolioId: asset.portfolioId, projectId: asset.projectId }
    } else {
      if (!q.data.portfolioId || !q.data.projectId) {
        return auditedJsonError(
          ctx,
          event,
          400,
          'VALIDATION',
          'Para este entityType indique portfolioId y projectId en la query (alcance RBAC)',
        )
      }
      scope = { portfolioId: q.data.portfolioId, projectId: q.data.projectId }
    }
    const denied = requireRbac(ctx, event, rbacState, 'asset:read', scope)
    if (denied) return denied
    const { entityType, entityId } = q.data
    const items = await docRepo.listDocumentsForEntity(ctx.tenantId, entityType, entityId)
    const requirements = await docRepo.listDocumentRequirements(ctx.tenantId, entityType)
    const missingDocuments = computeMissingRequiredDocuments(requirements, items)
    return finalizeAudit(ctx, event, json(200, { items, missingDocuments }))
  }

  // POST /v1/documents
  if (seg.length === 2 && method === 'POST') {
    if (!bucket) {
      return auditedJsonError(
        ctx,
        event,
        503,
        'DOCUMENTS_BUCKET_NOT_CONFIGURED',
        'APIP_DOCUMENTS_BUCKET_NAME no está configurado',
      )
    }
    const body = createDocumentBody.safeParse(parseBody(event.body))
    if (!body.success) {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
    }
    const b = body.data
    const scope = await resolveDocumentScope(
      ctx.tenantId,
      b.entityType,
      b.entityId,
      b.portfolioId,
      b.projectId,
    )
    if (!scope.ok) return scopeErrorToHttp(ctx, event, scope.code)
    const deniedUp = requireRbac(ctx, event, rbacState, 'document:upload', {
      portfolioId: scope.portfolioId,
      projectId: scope.projectId,
    })
    if (deniedUp) return deniedUp

    const documentId = newId.document()
    const s3Key = buildDocumentObjectKey({
      tenantId: ctx.tenantId,
      portfolioId: scope.portfolioId,
      projectId: scope.projectId,
      entityType: b.entityType,
      entityId: b.entityId,
      documentId,
      fileName: b.fileName,
    })

    const now = new Date().toISOString()
    const doc: Document = {
      id: documentId,
      tenantId: ctx.tenantId,
      portfolioId: scope.portfolioId,
      projectId: scope.projectId,
      entityType: b.entityType,
      entityId: b.entityId,
      name: b.name,
      fileName: b.fileName,
      mimeType: b.mimeType,
      size: b.size,
      s3Key,
      status: 'pending',
      required: b.required,
      requirementId: b.requirementId,
      createdAt: now,
    }
    await docRepo.putDocument(doc)

    const uploadUrl = await presignPutDocument({
      bucket,
      key: s3Key,
      contentType: b.mimeType,
    })

    return finalizeAudit(ctx, event, json(201, { documentId, uploadUrl, document: doc }))
  }

  const documentId = seg[2]
  if (!documentId || seg.length < 4) return null

  const existing = await docRepo.getDocument(ctx.tenantId, documentId)
  if (!existing) {
    return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Documento no encontrado')
  }

  const docScope = { portfolioId: existing.portfolioId, projectId: existing.projectId }

  // POST .../complete
  if (seg[3] === 'complete' && seg.length === 4 && method === 'POST') {
    if (!bucket) {
      return auditedJsonError(
        ctx,
        event,
        503,
        'DOCUMENTS_BUCKET_NOT_CONFIGURED',
        'APIP_DOCUMENTS_BUCKET_NAME no está configurado',
      )
    }
    const deniedUp = requireRbac(ctx, event, rbacState, 'document:upload', docScope)
    if (deniedUp) return deniedUp
    if (existing.status !== 'pending') {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'El documento no está pendiente de subida')
    }
    const exists = await headObjectExists(bucket, existing.s3Key)
    if (!exists) {
      return auditedJsonError(ctx, event, 400, 'UPLOAD_MISSING', 'No se encontró el objeto en S3; complete el PUT primero')
    }
    const uploadedAt = new Date().toISOString()
    const updated: Document = {
      ...existing,
      status: 'uploaded',
      uploadedAt,
    }
    await docRepo.putDocument(updated)
    return finalizeAudit(ctx, event, json(200, updated))
  }

  // POST .../validate
  if (seg[3] === 'validate' && seg.length === 4 && method === 'POST') {
    const deniedVal = requireRbac(ctx, event, rbacState, 'document:validate', docScope)
    if (deniedVal) return deniedVal
    if (existing.status !== 'uploaded') {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Solo se pueden validar documentos en estado uploaded')
    }
    const validatedAt = new Date().toISOString()
    const updated: Document = {
      ...existing,
      status: 'validated',
      validatedAt,
    }
    await docRepo.putDocument(updated)
    return finalizeAudit(ctx, event, json(200, updated))
  }

  // POST .../reject
  if (seg[3] === 'reject' && seg.length === 4 && method === 'POST') {
    const deniedVal = requireRbac(ctx, event, rbacState, 'document:validate', docScope)
    if (deniedVal) return deniedVal
    const body = rejectDocumentBody.safeParse(parseBody(event.body))
    if (!body.success) {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
    }
    if (existing.status !== 'uploaded' && existing.status !== 'validated') {
      return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Solo se pueden rechazar documentos uploaded o validated')
    }
    const rejectedAt = new Date().toISOString()
    const updated: Document = {
      ...existing,
      status: 'rejected',
      rejectedAt,
      rejectReason: body.data.reason,
    }
    await docRepo.putDocument(updated)
    return finalizeAudit(ctx, event, json(200, updated))
  }

  // GET .../download
  if (seg[3] === 'download' && seg.length === 4 && method === 'GET') {
    if (!bucket) {
      return auditedJsonError(
        ctx,
        event,
        503,
        'DOCUMENTS_BUCKET_NOT_CONFIGURED',
        'APIP_DOCUMENTS_BUCKET_NAME no está configurado',
      )
    }
    const deniedView = requireRbac(ctx, event, rbacState, 'asset:read', docScope)
    if (deniedView) return deniedView
    const downloadUrl = await presignGetDocument({ bucket, key: existing.s3Key })
    return finalizeAudit(ctx, event, json(200, { downloadUrl, mimeType: existing.mimeType, fileName: existing.fileName }))
  }

  return null
}
