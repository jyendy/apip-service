import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { randomUUID } from 'crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { jsonError } from './http'

const client = new EventBridgeClient({})

export const AUDIT_SOURCE = 'apip.audit'
export const AUDIT_DETAIL_TYPE = 'AuditRecord'

export type AuditRecordPayload = {
  auditId: string
  occurredAt: string
  tenantId: string
  actorSub?: string
  httpMethod: string
  path: string
  outcome: 'success' | 'failure'
  action: string
  resource: string
  resourceId?: string
  errorCode?: string
  message?: string
  metadata?: Record<string, unknown>
}

export type AuditContext = {
  tenantId: string
  subject?: string
}

export async function emitAuditRecord(
  p: Omit<AuditRecordPayload, 'auditId' | 'occurredAt'> & { auditId?: string; occurredAt?: string },
): Promise<void> {
  const bus = process.env.EVENT_BUS_NAME
  if (!bus) return
  const auditId = p.auditId ?? randomUUID()
  const occurredAt = p.occurredAt ?? new Date().toISOString()
  const full: AuditRecordPayload = {
    auditId,
    occurredAt,
    tenantId: p.tenantId,
    actorSub: p.actorSub,
    httpMethod: p.httpMethod,
    path: p.path,
    outcome: p.outcome,
    action: p.action,
    resource: p.resource,
    resourceId: p.resourceId,
    errorCode: p.errorCode,
    message: p.message,
    metadata: p.metadata,
  }
  try {
    await client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: bus,
            Source: AUDIT_SOURCE,
            DetailType: AUDIT_DETAIL_TYPE,
            Detail: JSON.stringify(full),
          },
        ],
      }),
    )
  } catch (e) {
    console.error('emitAuditRecord failed', e)
  }
}

export function inferAction(method: string): string {
  const m = method.toUpperCase()
  if (m === 'GET') return 'read'
  if (m === 'POST') return 'create'
  if (m === 'PATCH' || m === 'PUT') return 'update'
  if (m === 'DELETE') return 'delete'
  return m.toLowerCase()
}

/** Clave estable derivada del path (p. ej. assets, tms/orders, access/roles). */
export function inferResourceKey(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts[0] !== 'v1') return parts.join('/') || 'root'
  return parts.slice(1).join('/') || 'root'
}

function responseStatus(res: APIGatewayProxyResultV2): number | undefined {
  if (typeof res === 'object' && res !== null && 'statusCode' in res) {
    const c = (res as { statusCode?: number }).statusCode
    return typeof c === 'number' ? c : undefined
  }
  return undefined
}

export function finalizeAudit(
  ctx: AuditContext | undefined,
  event: APIGatewayProxyEventV2,
  response: APIGatewayProxyResultV2,
): APIGatewayProxyResultV2 {
  if (!ctx) return response
  const sc = responseStatus(response)
  if (sc !== undefined && sc >= 200 && sc < 300) {
    void emitAuditRecord({
      tenantId: ctx.tenantId,
      actorSub: ctx.subject,
      httpMethod: event.requestContext.http.method,
      path: event.rawPath ?? '',
      outcome: 'success',
      action: inferAction(event.requestContext.http.method),
      resource: inferResourceKey(event.rawPath ?? ''),
      metadata: { statusCode: sc },
    })
  }
  return response
}

export function finalizePlatformAudit(
  event: APIGatewayProxyEventV2,
  platformSubject: string,
  response: APIGatewayProxyResultV2,
): APIGatewayProxyResultV2 {
  const sc = responseStatus(response)
  if (sc !== undefined && sc >= 200 && sc < 300) {
    void emitAuditRecord({
      tenantId: '_platform_',
      actorSub: platformSubject,
      httpMethod: event.requestContext.http.method,
      path: event.rawPath ?? '',
      outcome: 'success',
      action: inferAction(event.requestContext.http.method),
      resource: inferResourceKey(event.rawPath ?? ''),
      metadata: { statusCode: sc, scope: 'platform_admin' },
    })
  }
  return response
}

export function auditedJsonError(
  ctx: AuditContext | undefined,
  event: APIGatewayProxyEventV2,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): APIGatewayProxyResultV2 {
  void emitAuditRecord({
    tenantId: ctx?.tenantId ?? 'unknown',
    actorSub: ctx?.subject,
    httpMethod: event.requestContext.http.method,
    path: event.rawPath ?? '',
    outcome: 'failure',
    action: inferAction(event.requestContext.http.method),
    resource: inferResourceKey(event.rawPath ?? ''),
    errorCode: code,
    message,
    metadata: details ? { detailsPreview: JSON.stringify(details).slice(0, 2000) } : undefined,
  })
  return jsonError(statusCode, code, message, details)
}
