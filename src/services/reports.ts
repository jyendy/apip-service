import * as repo from '../repositories/core-repository'
import { computeAssetMetricsForAsset } from './metrics'
import type { Asset, Portfolio } from '../domain/types'

export type InvestmentSummaryRow = {
  assetId: string
  name: string
  type: string
  portfolioId: string
  projectId: string
  capital: number
  roi: number
  irr: number
  npv: number
  status: string
}

export async function buildInvestmentSummaryReport(tenantId: string): Promise<{
  generatedAt: string
  kpis: {
    totalCapitalDeployed: number
    portfolioROI: number
    irr: number
    netCashFlowYTD: number
    weightedROI: number
  }
  assets: InvestmentSummaryRow[]
}> {
  const assets = await repo.listAssetsByTenant(tenantId, {})
  const totalCap = assets.reduce((s, x) => s + x.initialInvestment, 0)
  let totalRev = 0
  let totalCost = 0
  const rows: InvestmentSummaryRow[] = []
  let irrSum = 0
  let wSum = 0

  for (const asset of assets) {
    const rev = await repo.listRevenueFacts(tenantId, asset.id)
    const cost = await repo.listCostFacts(tenantId, asset.id)
    const m = await computeAssetMetricsForAsset(tenantId, asset, rev, cost)
    totalRev += m.accumulatedRevenue
    totalCost += m.operatingCosts
    irrSum += m.irr
    wSum += m.roi * (asset.initialInvestment / (totalCap || 1))
    rows.push({
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      portfolioId: asset.portfolioId,
      projectId: asset.projectId,
      capital: asset.initialInvestment,
      roi: m.roi,
      irr: m.irr,
      npv: m.npv,
      status: asset.status,
    })
  }

  const netCashFlowYTD = totalRev - totalCost
  const portfolioROI = totalCap ? (netCashFlowYTD / totalCap) * 100 : 0
  const irrAvg = assets.length ? irrSum / assets.length : 0

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      totalCapitalDeployed: totalCap,
      portfolioROI,
      irr: irrAvg,
      netCashFlowYTD,
      weightedROI: wSum,
    },
    assets: rows,
  }
}

export type AssetRegisterRow = InvestmentSummaryRow & {
  accumulatedRevenue: number
  operatingCosts: number
  ebitda: number
  netProfit: number
  currency: string
  acquisitionDate: string
}

export async function buildAssetRegisterReport(tenantId: string): Promise<{
  generatedAt: string
  items: AssetRegisterRow[]
}> {
  const assets = await repo.listAssetsByTenant(tenantId, {})
  const items: AssetRegisterRow[] = []
  for (const asset of assets) {
    const rev = await repo.listRevenueFacts(tenantId, asset.id)
    const cost = await repo.listCostFacts(tenantId, asset.id)
    const m = await computeAssetMetricsForAsset(tenantId, asset, rev, cost)
    items.push({
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      portfolioId: asset.portfolioId,
      projectId: asset.projectId,
      capital: asset.initialInvestment,
      roi: m.roi,
      irr: m.irr,
      npv: m.npv,
      status: asset.status,
      accumulatedRevenue: m.accumulatedRevenue,
      operatingCosts: m.operatingCosts,
      ebitda: m.ebitda,
      netProfit: m.netProfit,
      currency: asset.currency,
      acquisitionDate: asset.acquisitionDate,
    })
  }
  return { generatedAt: new Date().toISOString(), items }
}

export type PortfolioSnapshotRow = {
  portfolioId: string
  portfolioName: string
  assetCount: number
  totalCapital: number
  weightedRoi: number
  avgIrr: number
}

export async function buildPortfolioSnapshotReport(tenantId: string): Promise<{
  generatedAt: string
  portfolios: PortfolioSnapshotRow[]
}> {
  const portfolios = await repo.listPortfolios(tenantId)
  const byId = new Map<string, Portfolio>(portfolios.map(p => [p.id, p]))
  const assets = await repo.listAssetsByTenant(tenantId, {})
  const grouped = new Map<string, Asset[]>()
  for (const a of assets) {
    const cur = grouped.get(a.portfolioId) ?? []
    cur.push(a)
    grouped.set(a.portfolioId, cur)
  }

  const portfoliosOut: PortfolioSnapshotRow[] = []
  for (const [portfolioId, plist] of grouped) {
    const pf = byId.get(portfolioId)
    const totalCap = plist.reduce((s, x) => s + x.initialInvestment, 0)
    let wRoi = 0
    let irrAcc = 0
    for (const asset of plist) {
      const rev = await repo.listRevenueFacts(tenantId, asset.id)
      const cost = await repo.listCostFacts(tenantId, asset.id)
      const m = await computeAssetMetricsForAsset(tenantId, asset, rev, cost)
      const w = totalCap > 0 ? asset.initialInvestment / totalCap : 0
      wRoi += m.roi * w
      irrAcc += m.irr
    }
    const n = plist.length
    portfoliosOut.push({
      portfolioId,
      portfolioName: pf?.name ?? portfolioId,
      assetCount: n,
      totalCapital: totalCap,
      weightedRoi: wRoi,
      avgIrr: n ? irrAcc / n : 0,
    })
  }

  for (const p of portfolios) {
    if (!grouped.has(p.id)) {
      portfoliosOut.push({
        portfolioId: p.id,
        portfolioName: p.name,
        assetCount: 0,
        totalCapital: 0,
        weightedRoi: 0,
        avgIrr: 0,
      })
    }
  }

  portfoliosOut.sort((a, b) => a.portfolioName.localeCompare(b.portfolioName))

  return { generatedAt: new Date().toISOString(), portfolios: portfoliosOut }
}
