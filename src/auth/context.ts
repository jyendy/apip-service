import type { APIGatewayProxyEventV2 } from 'aws-lambda'

/** API Gateway HTTP API + JWT authorizer (claims no siempre tipados en @types/aws-lambda). */
type RequestContextWithJwt = APIGatewayProxyEventV2['requestContext'] & {
  authorizer?: { jwt?: { claims?: Record<string, string> } }
}

export type RequestContext = {
  tenantId: string
  subject?: string
}

export function resolveRequestContext(event: APIGatewayProxyEventV2): RequestContext {
  const jwt = (event.requestContext as RequestContextWithJwt).authorizer?.jwt
  const claims = jwt?.claims as Record<string, string> | undefined

  const fromClaims =
    claims?.['custom:tenantId'] ?? claims?.tenantId ?? claims?.['custom:tenant_id']

  if (fromClaims) {
    return { tenantId: fromClaims, subject: claims?.sub }
  }

  if (process.env.ALLOW_DEV_TENANT_HEADER === 'true') {
    const h = event.headers?.['x-tenant-id'] ?? event.headers?.['X-Tenant-Id']
    if (h) return { tenantId: h }
  }

  throw new Error('UNAUTHORIZED')
}
