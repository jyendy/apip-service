import type { APIGatewayProxyEventV2 } from 'aws-lambda'

/** API Gateway HTTP API + JWT authorizer (claims no siempre tipados en @types/aws-lambda). */
type RequestContextWithJwt = APIGatewayProxyEventV2['requestContext'] & {
  authorizer?: { jwt?: { claims?: Record<string, string> } }
}

export type RequestContext = {
  tenantId: string
  subject?: string
}

/** Claims JWT sin validar tenant (p. ej. admin de plataforma). */
export function getJwtClaims(event: APIGatewayProxyEventV2): Record<string, string> | undefined {
  const jwt = (event.requestContext as RequestContextWithJwt).authorizer?.jwt
  return jwt?.claims as Record<string, string> | undefined
}

/** Nombres de grupos Cognito que otorgan acceso a `/v1/admin/*` (lista separada por comas en `PLATFORM_ADMIN_GROUP`). */
function configuredPlatformAdminGroups(): string[] {
  const raw = process.env.PLATFORM_ADMIN_GROUP ?? 'apip-platform-admin,admin'
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/** `0` o `false` desactiva logs de denegación de admin de plataforma (CloudWatch). Por defecto activo. */
function platformAdminLoggingEnabled(): boolean {
  const v = process.env.APIP_LOG_PLATFORM_ADMIN
  if (v === '0' || v === 'false') return false
  return true
}

function logPlatformAdminDenied(event: APIGatewayProxyEventV2, detail: Record<string, unknown>): void {
  if (!platformAdminLoggingEnabled()) return
  const rc = event.requestContext as { requestId?: string; http?: { requestId?: string } }
  const reqId = rc?.requestId ?? rc?.http?.requestId
  console.warn(
    JSON.stringify({
      tag: 'PLATFORM_ADMIN_DENIED',
      time: new Date().toISOString(),
      path: event.rawPath ?? '',
      method: event.requestContext?.http?.method ?? '',
      requestId: reqId ?? null,
      ...detail,
    }),
  )
}

/**
 * Usuario con permiso para /v1/admin/* (grupo Cognito o claim).
 * Variable `PLATFORM_ADMIN_GROUP`: uno o varios nombres de grupo separados por comas (p. ej. `apip-platform-admin,admin`).
 */
export function resolvePlatformAdmin(event: APIGatewayProxyEventV2): { subject: string } | null {
  const claims = getJwtClaims(event)
  const path = event.rawPath ?? ''
  const method = event.requestContext?.http?.method ?? ''

  if (!claims) {
    logPlatformAdminDenied(event, {
      reason: 'no_jwt_claims',
      hint: 'API Gateway JWT authorizer no expuso requestContext.authorizer.jwt.claims (revisar autorizer HTTP API y audience/issuer).',
    })
    return null
  }

  if (!claims.sub) {
    logPlatformAdminDenied(event, {
      reason: 'no_sub_claim',
      claimKeys: Object.keys(claims).sort(),
      hint: 'El JWT no incluye `sub` (token inválido o claims incompletos).',
    })
    return null
  }

  const raw = claims['cognito:groups']
  const groups = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : []
  const allowed = configuredPlatformAdminGroups()
  const matchedGroup = allowed.find(g => groups.includes(g)) ?? null

  if (matchedGroup) {
    if (process.env.APIP_DEBUG_PLATFORM_ADMIN === '1' || process.env.APIP_DEBUG_PLATFORM_ADMIN === 'true') {
      console.log(
        JSON.stringify({
          tag: 'PLATFORM_ADMIN_OK',
          time: new Date().toISOString(),
          path,
          method,
          subjectPrefix: claims.sub.slice(0, 8),
          matchedGroup,
        }),
      )
    }
    return { subject: claims.sub }
  }

  const platformClaim = claims['custom:platformAdmin']
  if (platformClaim === 'true') {
    if (process.env.APIP_DEBUG_PLATFORM_ADMIN === '1' || process.env.APIP_DEBUG_PLATFORM_ADMIN === 'true') {
      console.log(
        JSON.stringify({
          tag: 'PLATFORM_ADMIN_OK',
          time: new Date().toISOString(),
          path,
          method,
          subjectPrefix: claims.sub.slice(0, 8),
          via: 'custom:platformAdmin',
        }),
      )
    }
    return { subject: claims.sub }
  }

  logPlatformAdminDenied(event, {
    reason: 'no_platform_admin_role',
    subjectPrefix: claims.sub.slice(0, 8),
    cognitoGroupsFromToken: groups,
    cognitoGroupsRawPresent: Boolean(raw),
    customPlatformAdmin: platformClaim ?? null,
    configuredAllowedGroups: allowed,
    hint: 'Ningún grupo de PLATFORM_ADMIN_GROUP coincide con cognito:groups y custom:platformAdmin no es "true".',
  })
  return null
}

export function resolveRequestContext(event: APIGatewayProxyEventV2): RequestContext {
  const claims = getJwtClaims(event)

  // Cognito: el atributo debe llamarse `tenantId` en el pool; si se definió como `custom:tenantId`,
  // el claim puede llegar como `custom:custom:tenantId`.
  const fromClaims =
    claims?.['custom:tenantId'] ??
    claims?.['custom:custom:tenantId'] ??
    claims?.tenantId ??
    claims?.['custom:tenant_id']

  if (fromClaims) {
    return { tenantId: fromClaims, subject: claims?.sub }
  }

  if (process.env.ALLOW_DEV_TENANT_HEADER === 'true') {
    const h = event.headers?.['x-tenant-id'] ?? event.headers?.['X-Tenant-Id']
    if (h) return { tenantId: h }
  }

  throw new Error('UNAUTHORIZED')
}
