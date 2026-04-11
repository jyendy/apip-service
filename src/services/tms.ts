import { COST_CATEGORY_CATALOG } from '../domain/cost-categories'
import * as repo from '../repositories/core-repository'
import type { Asset } from '../domain/types'

export function isKnownCostCategory(code: string): boolean {
  return COST_CATEGORY_CATALOG.some(c => c.code === code)
}

export async function requireTransportAsset(tenantId: string, assetId: string): Promise<Asset> {
  const a = await repo.getAsset(tenantId, assetId)
  if (!a) throw new Error('ASSET_NOT_FOUND')
  if (a.type !== 'transport') throw new Error('ASSET_NOT_TRANSPORT')
  return a
}

export async function buildTmsSummary(tenantId: string): Promise<{
  orders: Awaited<ReturnType<typeof repo.listTransportOrders>>
  trips: Awaited<ReturnType<typeof repo.listTransportTrips>>
  transportAssets: Awaited<ReturnType<typeof repo.listAssetsByTenant>>
  revenueFromTms: number
  costFromTms: number
  alerts: string[]
}> {
  const [orders, trips, assets] = await Promise.all([
    repo.listTransportOrders(tenantId),
    repo.listTransportTrips(tenantId),
    repo.listAssetsByTenant(tenantId, { type: 'transport' }),
  ])
  let revenueFromTms = 0
  let costFromTms = 0
  for (const a of assets) {
    const rev = await repo.listRevenueFacts(tenantId, a.id)
    const cost = await repo.listCostFacts(tenantId, a.id)
    revenueFromTms += rev.filter(r => r.sourceRef?.kind === 'tms_trip').reduce((s, x) => s + x.amount, 0)
    costFromTms += cost.filter(c => c.sourceRef?.kind === 'tms_trip').reduce((s, x) => s + x.amount, 0)
  }
  const alerts: string[] = []
  const activeTrips = trips.filter(t => t.status === 'IN_PROGRESS' || t.status === 'PLANNED')
  for (const t of activeTrips) {
    if (t.status === 'IN_PROGRESS' && !t.startDate) alerts.push(`Viaje ${t.id}: en curso sin fecha de inicio`)
  }
  for (const o of orders) {
    if (o.status !== 'COMPLETED' && new Date(o.scheduledDate) < new Date()) {
      alerts.push(`Orden ${o.id}: fecha programada pasada y estado ${o.status}`)
    }
  }
  return { orders, trips, transportAssets: assets, revenueFromTms, costFromTms, alerts }
}
