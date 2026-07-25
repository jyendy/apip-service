import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DUE_DILIGENCE_ITEMS,
  FLIP_PURCHASE_TYPES,
  FLIP_REHAB_CATEGORIES,
  rehabCategoryToCostCategory,
  shouldSyncCostFactForRehab,
  shouldSyncRevenueFactForSale,
  validateSoldProjectReady,
} from './flipping'

describe('flipping service', () => {
  it('maps rehab category other to flip_other cost code', () => {
    expect(rehabCategoryToCostCategory('kitchen')).toBe('kitchen')
    expect(rehabCategoryToCostCategory('other')).toBe('flip_other')
  })

  it('syncs cost facts only for in_progress or completed rehabs with amount', () => {
    expect(shouldSyncCostFactForRehab({ amount: 100, status: 'completed' })).toBe(true)
    expect(shouldSyncCostFactForRehab({ amount: 100, status: 'in_progress' })).toBe(true)
    expect(shouldSyncCostFactForRehab({ amount: 100, status: 'planned' })).toBe(false)
    expect(shouldSyncCostFactForRehab({ amount: 0, status: 'completed' })).toBe(false)
    expect(shouldSyncCostFactForRehab({ amount: 100, status: 'cancelled' })).toBe(false)
  })

  it('syncs revenue facts only for sold projects with price and sale date', () => {
    expect(
      shouldSyncRevenueFactForSale({
        workflowStatus: 'sold',
        salePrice: 250000,
        actualSaleDate: '2026-01-15T00:00:00.000Z',
      }),
    ).toBe(true)
    expect(
      shouldSyncRevenueFactForSale({
        workflowStatus: 'listed',
        salePrice: 250000,
        actualSaleDate: '2026-01-15T00:00:00.000Z',
      }),
    ).toBe(false)
    expect(
      shouldSyncRevenueFactForSale({
        workflowStatus: 'sold',
        salePrice: 0,
        actualSaleDate: '2026-01-15T00:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('requires sale price and date when workflow is sold', () => {
    expect(
      validateSoldProjectReady({
        workflowStatus: 'sold',
        salePrice: 100000,
        actualSaleDate: '2026-01-15T00:00:00.000Z',
      }),
    ).toBeNull()
    expect(
      validateSoldProjectReady({
        workflowStatus: 'sold',
        salePrice: undefined,
        actualSaleDate: '2026-01-15T00:00:00.000Z',
      }),
    ).toBe('SALE_PRICE_REQUIRED')
    expect(
      validateSoldProjectReady({
        workflowStatus: 'rehab',
        salePrice: undefined,
        actualSaleDate: undefined,
      }),
    ).toBeNull()
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
