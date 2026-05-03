import * as repo from '../repositories/core-repository'
import type { Investor } from '../domain/types'
import { computeAssetMetrics } from './metrics'

export type InvestorExposure = {
  investorId: string
  capitalDeployed: number
  weightedROI: number
  avgIRR: number
  assetCount: number
  byPortfolio: Array<{ portfolioId: string; capital: number; assetCount: number; weightedROI: number; avgIRR: number }>
}

export async function buildInvestorExposure(tenantId: string, investor: Investor): Promise<InvestorExposure> {
  let capitalDeployed = 0
  let roiWeightedSum = 0
  let irrSum = 0
  let assetCount = 0
  const byPortfolio: InvestorExposure['byPortfolio'] = []

  for (const portfolioId of investor.portfolioIds) {
    const assets = await repo.listAssetsByTenant(tenantId, { portfolioId })
    let portCap = 0
    let portRoiW = 0
    let portIrr = 0
    for (const asset of assets) {
      const rev = await repo.listRevenueFacts(tenantId, asset.id)
      const cost = await repo.listCostFacts(tenantId, asset.id)
      const m = computeAssetMetrics(asset, rev, cost)
      portCap += asset.initialInvestment
      portRoiW += m.roi * asset.initialInvestment
      portIrr += m.irr
      assetCount += 1
    }
    const wRoiP = portCap > 0 ? portRoiW / portCap : 0
    const avgIrP = assets.length > 0 ? portIrr / assets.length : 0
    capitalDeployed += portCap
    roiWeightedSum += portRoiW
    irrSum += portIrr
    byPortfolio.push({
      portfolioId,
      capital: portCap,
      assetCount: assets.length,
      weightedROI: wRoiP,
      avgIRR: avgIrP,
    })
  }

  const weightedROI = capitalDeployed > 0 ? roiWeightedSum / capitalDeployed : 0
  const avgIRR = assetCount > 0 ? irrSum / assetCount : 0

  return {
    investorId: investor.id,
    capitalDeployed,
    weightedROI,
    avgIRR,
    assetCount,
    byPortfolio,
  }
}
