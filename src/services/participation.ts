import * as repo from '../repositories/core-repository'
import type { Investor, InvestorLedgerEntry, ProjectInvestorAllocation } from '../domain/types'

const EPS = 0.01

export function balanceFromLedger(entries: InvestorLedgerEntry[]): number {
  let b = 0
  for (const e of entries) {
    if (e.type === 'contribution') b += e.amount
    else b -= e.amount
  }
  return b
}

export async function projectDeployedCapital(tenantId: string, projectId: string): Promise<number> {
  const assets = await repo.listAssetsByTenant(tenantId, { projectId })
  return assets.reduce((s, a) => s + a.initialInvestment, 0)
}

export async function totalAllocatedForInvestorExceptProject(
  tenantId: string,
  investorId: string,
  excludeProjectId: string,
): Promise<number> {
  const projects = await repo.listProjects(tenantId)
  let sum = 0
  for (const p of projects) {
    if (p.id === excludeProjectId) continue
    const allocs = await repo.listProjectInvestorAllocations(tenantId, p.id)
    const row = allocs.find(x => x.investorId === investorId)
    if (row) sum += row.amount
  }
  return sum
}

export async function totalAllocatedForInvestor(tenantId: string, investorId: string): Promise<number> {
  const projects = await repo.listProjects(tenantId)
  let sum = 0
  for (const p of projects) {
    const allocs = await repo.listProjectInvestorAllocations(tenantId, p.id)
    const row = allocs.find(x => x.investorId === investorId)
    if (row) sum += row.amount
  }
  return sum
}

export async function validateAndReplaceProjectAllocations(
  tenantId: string,
  projectId: string,
  allocations: { investorId: string; amount: number }[],
): Promise<void> {
  const project = await repo.getProject(tenantId, projectId)
  if (!project) throw new Error('PROJECT_NOT_FOUND')

  const deployed = await projectDeployedCapital(tenantId, projectId)
  const sumAlloc = allocations.reduce((s, a) => s + a.amount, 0)
  if (sumAlloc > deployed + EPS) {
    throw new Error(
      `ALLOC_EXCEEDS_DEPLOYED: la suma asignada (${sumAlloc}) supera el capital desplegado del proyecto (${deployed})`,
    )
  }

  const seen = new Set<string>()
  for (const row of allocations) {
    if (row.amount <= 0) continue
    if (seen.has(row.investorId)) throw new Error('DUPLICATE_INVESTOR_IN_PROJECT')
    seen.add(row.investorId)

    const inv = await repo.getInvestor(tenantId, row.investorId)
    if (!inv) throw new Error(`INVESTOR_NOT_FOUND:${row.investorId}`)

    const ledger = await repo.listInvestorLedgerEntries(tenantId, row.investorId)
    const balance = balanceFromLedger(ledger)
    const other = await totalAllocatedForInvestorExceptProject(tenantId, row.investorId, projectId)
    if (other + row.amount > balance + EPS) {
      throw new Error(
        `ALLOC_EXCEEDS_INVESTOR_BALANCE: ${inv.name} — otras asignaciones ${other} + ${row.amount} > saldo ${balance}`,
      )
    }
  }

  const existing = await repo.listProjectInvestorAllocations(tenantId, projectId)
  for (const e of existing) {
    await repo.deleteProjectInvestorAllocation(tenantId, projectId, e.investorId)
  }

  const now = new Date().toISOString()
  for (const row of allocations) {
    if (row.amount <= 0) continue
    const a: ProjectInvestorAllocation = {
      tenantId,
      projectId,
      investorId: row.investorId,
      amount: row.amount,
      createdAt: now,
      updatedAt: now,
    }
    await repo.putProjectInvestorAllocation(a)
  }
}

export type ProjectCapitalParticipation = {
  projectId: string
  portfolioId: string
  deployedCapital: number
  allocations: Array<{
    investorId: string
    investorName: string
    amount: number
    percentOfDeployed: number
  }>
  unassignedAmount: number
  unassignedPercent: number
}

export async function buildProjectCapitalParticipation(
  tenantId: string,
  projectId: string,
): Promise<ProjectCapitalParticipation | null> {
  const project = await repo.getProject(tenantId, projectId)
  if (!project) return null
  const deployed = await projectDeployedCapital(tenantId, projectId)
  const rows = await repo.listProjectInvestorAllocations(tenantId, projectId)
  const allocations: ProjectCapitalParticipation['allocations'] = []
  for (const r of rows) {
    const inv = await repo.getInvestor(tenantId, r.investorId)
    const pct = deployed > 0 ? (r.amount / deployed) * 100 : 0
    allocations.push({
      investorId: r.investorId,
      investorName: inv?.name ?? r.investorId,
      amount: r.amount,
      percentOfDeployed: pct,
    })
  }
  const assigned = rows.reduce((s, x) => s + x.amount, 0)
  const unassignedAmount = Math.max(0, deployed - assigned)
  const unassignedPercent = deployed > 0 ? (unassignedAmount / deployed) * 100 : 0
  return {
    projectId,
    portfolioId: project.portfolioId,
    deployedCapital: deployed,
    allocations,
    unassignedAmount,
    unassignedPercent,
  }
}

export type PortfolioCapitalParticipation = {
  portfolioId: string
  deployedCapital: number
  unassignedAmount: number
  projects: Array<{
    projectId: string
    projectName: string
    deployedCapital: number
    unassignedAmount: number
    assignedTotal: number
  }>
  /** Capital asignado por LP en todo el portfolio (suma de asignaciones en proyectos del portfolio). */
  byInvestor: Array<{
    investorId: string
    investorName: string
    allocatedAmount: number
    percentOfDeployed: number
  }>
  /**
   * Desglose por proyecto: misma información que en la vista de proyecto, agregada por LP.
   * Las asignaciones se siguen editando solo a nivel proyecto.
   */
  investorExposureByProject: Array<{
    investorId: string
    investorName: string
    allocatedTotal: number
    percentOfPortfolioDeployed: number
    byProject: Array<{
      projectId: string
      projectName: string
      amount: number
      percentOfProjectDeployed: number
    }>
  }>
}

export async function buildPortfolioCapitalParticipation(
  tenantId: string,
  portfolioId: string,
): Promise<PortfolioCapitalParticipation | null> {
  const pf = await repo.getPortfolio(tenantId, portfolioId)
  if (!pf) return null

  const projects = (await repo.listProjects(tenantId, portfolioId)).sort((a, b) => a.name.localeCompare(b.name))
  const projectSummaries: PortfolioCapitalParticipation['projects'] = []
  const investorTotals = new Map<string, number>()
  const investorByProject = new Map<
    string,
    Array<{ projectId: string; projectName: string; amount: number; projectDeployed: number }>
  >()

  let deployedTotal = 0
  let unassignedTotal = 0

  for (const p of projects) {
    const dep = await projectDeployedCapital(tenantId, p.id)
    const allocs = await repo.listProjectInvestorAllocations(tenantId, p.id)
    const assigned = allocs.reduce((s, x) => s + x.amount, 0)
    const unassigned = Math.max(0, dep - assigned)
    deployedTotal += dep
    unassignedTotal += unassigned
    for (const a of allocs) {
      investorTotals.set(a.investorId, (investorTotals.get(a.investorId) ?? 0) + a.amount)
      const list = investorByProject.get(a.investorId) ?? []
      list.push({
        projectId: p.id,
        projectName: p.name,
        amount: a.amount,
        projectDeployed: dep,
      })
      investorByProject.set(a.investorId, list)
    }
    projectSummaries.push({
      projectId: p.id,
      projectName: p.name,
      deployedCapital: dep,
      unassignedAmount: unassigned,
      assignedTotal: assigned,
    })
  }

  const byInvestor: PortfolioCapitalParticipation['byInvestor'] = []
  for (const [investorId, allocatedAmount] of [...investorTotals.entries()].sort((a, b) => b[1] - a[1])) {
    const inv = await repo.getInvestor(tenantId, investorId)
    byInvestor.push({
      investorId,
      investorName: inv?.name ?? investorId,
      allocatedAmount,
      percentOfDeployed: deployedTotal > 0 ? (allocatedAmount / deployedTotal) * 100 : 0,
    })
  }

  const investorExposureByProject: PortfolioCapitalParticipation['investorExposureByProject'] = []
  for (const [investorId, allocatedTotal] of [...investorTotals.entries()].sort((a, b) => b[1] - a[1])) {
    const inv = await repo.getInvestor(tenantId, investorId)
    const rawRows = investorByProject.get(investorId) ?? []
    const byProject = [...rawRows]
      .map(r => ({
        projectId: r.projectId,
        projectName: r.projectName,
        amount: r.amount,
        percentOfProjectDeployed:
          r.projectDeployed > 0 ? (r.amount / r.projectDeployed) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
    investorExposureByProject.push({
      investorId,
      investorName: inv?.name ?? investorId,
      allocatedTotal,
      percentOfPortfolioDeployed:
        deployedTotal > 0 ? (allocatedTotal / deployedTotal) * 100 : 0,
      byProject,
    })
  }

  return {
    portfolioId,
    deployedCapital: deployedTotal,
    unassignedAmount: unassignedTotal,
    projects: projectSummaries,
    byInvestor,
    investorExposureByProject,
  }
}

export async function buildInvestorCapitalAccount(tenantId: string, investor: Investor) {
  const ledger = await repo.listInvestorLedgerEntries(tenantId, investor.id)
  const balance = balanceFromLedger(ledger)
  const totalAllocated = await totalAllocatedForInvestor(tenantId, investor.id)
  return {
    investorId: investor.id,
    balance,
    totalAllocated,
    available: balance - totalAllocated,
    ledger: [...ledger].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  }
}
