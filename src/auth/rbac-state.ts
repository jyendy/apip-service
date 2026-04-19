import type { RequestContext } from './context'
import type { RbacPermission, RbacRole, RbacState, UserAssignment } from '../domain/rbac'
import type { PermissionKey } from '../domain/permission-keys'
import { newId } from '../lib/ids'
import * as accessRepo from '../repositories/access-repository'

/** Mapeo del catálogo legacy (`permission-keys`) al modelo RBAC nuevo. */
const LEGACY_TO_RBAC: Partial<Record<PermissionKey, RbacPermission[]>> = {
  'assets:read': ['asset:read'],
  'assets:write': ['asset:write'],
  'portfolios:read': ['asset:read'],
  'portfolios:write': ['asset:write'],
  'projects:read': ['asset:read'],
  'projects:write': ['asset:write'],
  'investors:read': ['financial:read'],
  'investors:write': ['user:manage'],
  'reports:read': ['financial:read'],
  'simulations:read': ['financial:read'],
  'simulations:write': ['financial:analyze'],
  'tms:read': ['asset:read'],
  'tms:write': ['operation:write'],
  'imports:write': ['operation:write'],
  'access:manage': ['user:manage'],
}

function uniq(perms: RbacPermission[]): RbacPermission[] {
  return [...new Set(perms)]
}

async function legacyPermissionsForProfile(
  tenantId: string,
  roleIds: string[],
): Promise<RbacPermission[]> {
  const out: RbacPermission[] = []
  for (const rid of roleIds) {
    const role = await accessRepo.getAccessRole(tenantId, rid)
    if (!role) continue
    for (const k of role.permissionKeys) {
      const mapped = LEGACY_TO_RBAC[k as PermissionKey]
      if (mapped) out.push(...mapped)
    }
  }
  return uniq(out)
}

/**
 * Carga el estado RBAC del usuario: asignaciones explícitas o permisos derivados de roles legacy.
 */
export async function loadRbacState(ctx: RequestContext): Promise<RbacState> {
  const sub = ctx.subject
  if (!sub) {
    return { mode: 'legacy', legacyPermissions: [] }
  }
  const profile = await accessRepo.getTenantUserProfile(ctx.tenantId, sub)
  if (!profile) {
    return { mode: 'legacy', legacyPermissions: [] }
  }

  const raw = profile.rbacAssignments
  if (raw && raw.length > 0) {
    const assignments: UserAssignment[] = raw.map(a => ({
      ...a,
      userId: a.userId || sub,
      tenantId: a.tenantId || ctx.tenantId,
    }))
    return { mode: 'rbac', assignments }
  }

  const legacy = await legacyPermissionsForProfile(ctx.tenantId, profile.roleIds ?? [])
  return { mode: 'legacy', legacyPermissions: legacy }
}

export function normalizeRbacAssignmentsInput(
  tenantId: string,
  userId: string,
  inputs: Array<{
    id?: string
    userId?: string
    tenantId?: string
    role: RbacRole
    portfolioId?: string
    projectId?: string
    createdAt?: string
  }>,
): UserAssignment[] {
  const now = new Date().toISOString()
  return inputs.map(a => ({
    id: a.id ?? newId.userAssignment(),
    userId: a.userId ?? userId,
    tenantId: a.tenantId ?? tenantId,
    role: a.role,
    portfolioId: a.portfolioId,
    projectId: a.projectId,
    createdAt: a.createdAt ?? now,
  }))
}
