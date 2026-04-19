import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { loadRbacState } from './rbac-state'
import type { RequestContext } from './context'

vi.mock('../repositories/access-repository', () => ({
  getTenantUserProfile: vi.fn(),
}))

import * as accessRepo from '../repositories/access-repository'

describe('loadRbacState bootstrap', () => {
  const ctx: RequestContext = { tenantId: 'ten_x', subject: 'cognito-sub-1' }

  beforeEach(() => {
    vi.mocked(accessRepo.getTenantUserProfile).mockReset()
    delete process.env.APIP_RBAC_STRICT
  })

  afterEach(() => {
    delete process.env.APIP_RBAC_STRICT
  })

  it('sin perfil devuelve permisos admin por defecto (no strict)', async () => {
    vi.mocked(accessRepo.getTenantUserProfile).mockResolvedValue(null)
    const s = await loadRbacState(ctx)
    expect(s.mode).toBe('legacy')
    if (s.mode === 'legacy') {
      expect(s.legacyPermissions).toContain('asset:read')
      expect(s.legacyPermissions).toContain('financial:analyze')
    }
  })

  it('sin perfil y APIP_RBAC_STRICT=true devuelve lista vacía', async () => {
    process.env.APIP_RBAC_STRICT = 'true'
    vi.mocked(accessRepo.getTenantUserProfile).mockResolvedValue(null)
    const s = await loadRbacState(ctx)
    expect(s.mode).toBe('legacy')
    if (s.mode === 'legacy') {
      expect(s.legacyPermissions).toEqual([])
    }
  })
})
