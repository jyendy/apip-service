import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { RequestContext } from './context'
import { auditedJsonError } from '../lib/audit'
import type { RbacPermission, RbacScopeContext, RbacState } from '../domain/rbac'
import { canAccess } from '../domain/rbac'

export function requireRbac(
  ctx: RequestContext,
  event: APIGatewayProxyEventV2,
  state: RbacState,
  permission: RbacPermission,
  scope: Pick<RbacScopeContext, 'portfolioId' | 'projectId'>,
): APIGatewayProxyResultV2 | null {
  const ok = canAccess(state, permission, {
    tenantId: ctx.tenantId,
    portfolioId: scope.portfolioId,
    projectId: scope.projectId,
  })
  if (ok) return null
  return auditedJsonError(ctx, event, 403, 'FORBIDDEN', `Permiso requerido: ${permission}`)
}
