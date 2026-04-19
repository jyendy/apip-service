import { describe, expect, it } from 'vitest'
import { canAccess, type RbacState, type UserAssignment } from './rbac'

const baseA = (over: Partial<UserAssignment>): UserAssignment => ({
  id: 'uas_1',
  userId: 'sub_x',
  tenantId: 'ten_x',
  role: 'investor',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

describe('canAccess', () => {
  it('permite alcance tenant-wide sin portfolio en asignación', () => {
    const state: RbacState = {
      mode: 'rbac',
      assignments: [baseA({ role: 'investor' })],
    }
    expect(
      canAccess(state, 'asset:read', { tenantId: 'ten_x', portfolioId: 'prt_1', projectId: 'prj_1' }),
    ).toBe(true)
  })

  it('restringe por portfolio cuando la asignación lo fija', () => {
    const state: RbacState = {
      mode: 'rbac',
      assignments: [baseA({ role: 'investor', portfolioId: 'prt_a' })],
    }
    expect(canAccess(state, 'asset:read', { tenantId: 'ten_x', portfolioId: 'prt_b' })).toBe(false)
    expect(canAccess(state, 'asset:read', { tenantId: 'ten_x', portfolioId: 'prt_a', projectId: 'prj_1' })).toBe(true)
  })

  it('legacy: usa lista plana de permisos', () => {
    const state: RbacState = {
      mode: 'legacy',
      legacyPermissions: ['financial:read'],
    }
    expect(canAccess(state, 'financial:read', { tenantId: 'ten_x' })).toBe(true)
    expect(canAccess(state, 'asset:write', { tenantId: 'ten_x' })).toBe(false)
  })
})
