import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DUE_DILIGENCE_ITEMS,
  FLIP_PURCHASE_TYPES,
  FLIP_REHAB_CATEGORIES,
  rehabCategoryToCostCategory,
  shouldSyncCostFactForRehab,
} from './flipping'

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

  it('exposes the complete reusable catalogs', () => {
    expect(FLIP_PURCHASE_TYPES).toEqual(['mls', 'auction', 'reo', 'short_sale'])
    expect(FLIP_REHAB_CATEGORIES).toEqual(
      expect.arrayContaining(['hoa', 'dumpster', 'permits', 'lawyer']),
    )
  })

  it('seeds due diligence grouped by the four supported phases', () => {
    expect(new Set(DEFAULT_DUE_DILIGENCE_ITEMS.map(item => item.phase))).toEqual(
      new Set(['review', 'budget_analysis', 'rehab', 'listing']),
    )
    expect(DEFAULT_DUE_DILIGENCE_ITEMS.map(item => item.name)).toContain('Final Inspection')
  })
})
