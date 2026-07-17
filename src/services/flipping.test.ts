import { describe, expect, it } from 'vitest'
import { rehabCategoryToCostCategory, shouldSyncCostFactForRehab } from './flipping'

describe('flipping service', () => {
  it('maps rehab category other to flip_other cost code', () => {
    expect(rehabCategoryToCostCategory('kitchen')).toBe('kitchen')
    expect(rehabCategoryToCostCategory('other')).toBe('flip_other')
  })

  it('skips cost fact sync for cancelled or zero amount rehabs', () => {
    expect(shouldSyncCostFactForRehab({ amount: 100, status: 'completed' })).toBe(true)
    expect(shouldSyncCostFactForRehab({ amount: 0, status: 'completed' })).toBe(false)
    expect(shouldSyncCostFactForRehab({ amount: 100, status: 'cancelled' })).toBe(false)
  })
})
