/**
 * RBAC con alcance (tenant → portfolio → proyecto).
 * Diseñado para evolucionar a ABAC (overrides, atributos).
 */

export type RbacRole = 'admin' | 'investor' | 'operator' | 'analyst' | 'auditor'

/** Asignación de rol + alcance opcional para un usuario en un tenant. */
export type UserAssignment = {
  id: string
  userId: string
  tenantId: string
  role: RbacRole
  portfolioId?: string
  projectId?: string
  createdAt: string
}

export type RbacPermission =
  | 'asset:read'
  | 'asset:write'
  | 'financial:read'
  | 'financial:analyze'
  | 'operation:write'
  | 'document:upload'
  | 'document:validate'
  | 'user:manage'

export const ROLE_PERMISSIONS: Record<RbacRole, RbacPermission[]> = {
  admin: [
    'asset:read',
    'asset:write',
    'financial:read',
    'financial:analyze',
    'operation:write',
    'document:upload',
    'document:validate',
    'user:manage',
  ],
  investor: ['asset:read', 'financial:read'],
  operator: ['asset:read', 'operation:write', 'document:upload'],
  analyst: ['asset:read', 'financial:read', 'financial:analyze'],
  auditor: ['asset:read', 'financial:read', 'document:validate'],
}

export type RbacScopeContext = {
  tenantId: string
  portfolioId?: string
  projectId?: string
}

export type RbacState =
  | {
      mode: 'rbac'
      assignments: UserAssignment[]
    }
  | {
      mode: 'legacy'
      /** Permisos efectivos del catálogo legacy (sin alcance por portfolio/proyecto). */
      legacyPermissions: RbacPermission[]
    }

function permissionsForRole(role: RbacRole): RbacPermission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

/** Una asignación encaja en el contexto si los límites de alcance coinciden cuando existen. */
export function assignmentMatchesScope(
  a: UserAssignment,
  ctx: { portfolioId?: string; projectId?: string },
): boolean {
  if (a.portfolioId) {
    if (!ctx.portfolioId || ctx.portfolioId !== a.portfolioId) return false
  }
  if (a.projectId) {
    if (!ctx.projectId || ctx.projectId !== a.projectId) return false
  }
  return true
}

export function canAccess(state: RbacState, permission: RbacPermission, context: RbacScopeContext): boolean {
  if (state.mode === 'legacy') {
    return state.legacyPermissions.includes(permission)
  }
  for (const a of state.assignments) {
    if (a.tenantId !== context.tenantId) continue
    if (!assignmentMatchesScope(a, context)) continue
    if (permissionsForRole(a.role).includes(permission)) return true
  }
  return false
}

/** Unión de permisos de todas las asignaciones (vista previa UI; `canAccess` sigue aplicando alcance). */
export function effectivePermissionsPreview(state: RbacState): RbacPermission[] {
  if (state.mode === 'legacy') return [...state.legacyPermissions]
  const set = new Set<RbacPermission>()
  for (const a of state.assignments) {
    for (const p of permissionsForRole(a.role)) {
      set.add(p)
    }
  }
  return [...set]
}
