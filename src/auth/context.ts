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

/**
 * Usuario con permiso para /v1/admin/* (grupo Cognito o claim).
 * Variable `PLATFORM_ADMIN_GROUP`: uno o varios nombres de grupo separados por comas (p. ej. `apip-platform-admin,admin`).
 */
export function resolvePlatformAdmin(event: APIGatewayProxyEventV2): { subject: string } | null {
  const claims = getJwtClaims(event)
  if (!claims?.sub) return null
  const raw = claims['cognito:groups']
  const groups = raw
    ? raw.split(',').map(s => s.trim()).filter(Boolean)
    : []
  const allowed = configuredPlatformAdminGroups()
  if (allowed.some(g => groups.includes(g))) return { subject: claims.sub }
  if (claims['custom:platformAdmin'] === 'true') return { subject: claims.sub }
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
