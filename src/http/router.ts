import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { resolvePlatformAdmin, resolveRequestContext } from '../auth/context'
import * as repo from '../repositories/core-repository'
import {
  createAssetBody,
  createInvestorBody,
  createPortfolioBody,
  createProjectBody,
  createTenantBody,
  importAssetsBody,
  investorLedgerEntryBody,
  listQuery,
  patchAssetBody,
  patchInvestorBody,
  patchPortfolioBody,
  patchProjectBody,
  patchTenantBody,
  patchSimulationBody,
  putAssetCashFlowsBody,
  putProjectInvestorAllocationsBody,
  simulationBody,
} from '../domain/schemas'
import { json, jsonError, noContent } from '../lib/http'
import { newId } from '../lib/ids'
import { publishDomainEvent } from '../lib/events'
import {
  buildMonthlyCashFlowSeries,
  CALCULATION_VERSION,
  irrMonthlyPercent,
  npvFromMonthlyFlows,
  simpleRoiPercent,
} from '../financial/engine'
import { computeAssetMetrics } from '../services/metrics'
import { buildStandardizedStructure } from '../services/structure'
import { buildInsights } from '../services/insights'
import {
  buildInvestorCapitalAccount,
  buildPortfolioCapitalParticipation,
  buildProjectCapitalParticipation,
  validateAndReplaceProjectAllocations,
} from '../services/participation'
import { buildInvestorExposure } from '../services/investors'
import { buildAssetRegisterReport, buildInvestmentSummaryReport, buildPortfolioSnapshotReport } from '../services/reports'
import type {
  Asset,
  CostFact,
  ImportJob,
  Investor,
  InvestorLedgerEntry,
  Portfolio,
  Project,
  RevenueFact,
  Simulation,
  Tenant,
} from '../domain/types'

const BUS = process.env.EVENT_BUS_NAME

function parseBody<T>(raw: string | undefined): T {
  if (!raw) return {} as T
  return JSON.parse(raw) as T
}

function segments(path: string): string[] {
  return path.replace(/\/+$/, '').split('/').filter(Boolean)
}

function computeSimulationProjection(input: {
  initialCapital: number
  expectedMonthlyRevenue: number
  expectedOperatingCost: number
  growthRatePercent?: number
  durationMonths: number
  discountRateAnnual?: number
}) {
  const growthMonthly = (input.growthRatePercent ?? 0) / 100 / 12
  const series = buildMonthlyCashFlowSeries({
    months: input.durationMonths,
    monthlyRevenue: input.expectedMonthlyRevenue,
    monthlyCosts: input.expectedOperatingCost,
    growthRateMonthly: growthMonthly,
    initialInvestment: input.initialCapital,
  })
  const nets = series.map(s => s.net)
  const flows = [-input.initialCapital, ...nets]
  const irr = irrMonthlyPercent(flows)
  const npv = npvFromMonthlyFlows(nets, input.discountRateAnnual ?? 0.1)
  const totalProfit = nets.reduce((a, s) => a + s, 0)
  const roi = simpleRoiPercent(totalProfit, input.initialCapital)
  const breakEvenMonth = series.findIndex((_row, i) => {
    const cum = series.slice(0, i + 1).reduce((x, y) => x + y.net, 0)
    return cum >= input.initialCapital
  })
  return { roi, irr, npv, breakEvenMonth }
}

async function ensureTenant(tenantId: string): Promise<APIGatewayProxyResultV2 | null> {
  const t = await repo.getTenant(tenantId)
  if (!t) return jsonError(404, 'TENANT_NOT_FOUND', 'Tenant no existe o no está inicializado')
  return null
}

async function routeAdmin(
  event: APIGatewayProxyEventV2,
  method: string,
  seg: string[],
): Promise<APIGatewayProxyResultV2> {
  if (seg[2] === 'tenants' && seg.length === 3) {
    if (method === 'GET') {
      const items = await repo.listTenants()
      return json(200, { items })
    }
    if (method === 'POST') {
      const body = createTenantBody.safeParse(parseBody(event.body))
      if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
      const now = new Date().toISOString()
      const id = body.data.id ?? newId.tenant()
      const t: Tenant = {
        id,
        name: body.data.name,
        type: body.data.type,
        createdAt: now,
      }
      await repo.putTenant(t)
      return json(201, t)
    }
  }
  if (seg[2] === 'tenants' && seg[3] && seg.length === 4) {
    const tenantId = seg[3]
    if (method === 'GET') {
      const t = await repo.getTenant(tenantId)
      if (!t) return jsonError(404, 'NOT_FOUND', 'Tenant no encontrado')
      return json(200, t)
    }
    if (method === 'PATCH') {
      const existing = await repo.getTenant(tenantId)
      if (!existing) return jsonError(404, 'NOT_FOUND', 'Tenant no encontrado')
      const body = patchTenantBody.safeParse(parseBody(event.body))
      if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
      const t: Tenant = {
        ...existing,
        ...body.data,
      }
      await repo.putTenant(t)
      return json(200, t)
    }
  }
  return jsonError(404, 'NOT_FOUND', `Ruta admin no implementada: ${method}`)
}

export async function route(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method
  if (method === 'OPTIONS') {
    return noContent()
  }

  const path = event.rawPath || ''
  if (path === '/health' && method === 'GET') {
    return json(200, { status: 'ok', service: 'apip-service' })
  }

  const seg = segments(path)

  if (seg[0] === 'v1' && seg[1] === 'admin') {
    const admin = resolvePlatformAdmin(event)
    if (!admin) {
      return jsonError(403, 'FORBIDDEN', 'Se requiere rol de administrador de plataforma (grupo Cognito o custom:platformAdmin)')
    }
    try {
      return await routeAdmin(event, method, seg)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(e)
      return jsonError(500, 'INTERNAL', msg)
    }
  }

  let ctx: ReturnType<typeof resolveRequestContext>
  try {
    ctx = resolveRequestContext(event)
  } catch {
    return jsonError(401, 'UNAUTHORIZED', 'No se pudo resolver tenantId (JWT o cabecera X-Tenant-Id en dev)')
  }

  const err = await ensureTenant(ctx.tenantId)
  if (err) return err

  try {
    // --- /v1/assets ---
    if (seg[0] === 'v1' && seg[1] === 'assets' && seg.length === 2) {
      if (method === 'GET') {
        const q = listQuery.safeParse(event.queryStringParameters ?? {})
        if (!q.success) return jsonError(400, 'VALIDATION', 'Query inválida', q.error.flatten())
        const assets = await repo.listAssetsByTenant(ctx.tenantId, {
          projectId: q.data.projectId,
          portfolioId: q.data.portfolioId,
          type: q.data.type,
        })
        return json(200, { items: assets, nextCursor: null })
      }
      if (method === 'POST') {
        const body = createAssetBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const b = body.data
        const pf = await repo.getPortfolio(ctx.tenantId, b.portfolioId)
        if (!pf) return jsonError(400, 'VALIDATION', 'portfolioId no existe')
        const pj = await repo.getProject(ctx.tenantId, b.projectId)
        if (!pj || pj.portfolioId !== b.portfolioId) {
          return jsonError(400, 'VALIDATION', 'projectId no existe o no pertenece al portfolio')
        }
        const now = new Date().toISOString()
        const asset: Asset = {
          id: newId.asset(),
          tenantId: ctx.tenantId,
          portfolioId: b.portfolioId,
          projectId: b.projectId,
          name: b.name,
          type: b.type,
          acquisitionDate: b.acquisitionDate,
          initialInvestment: b.initialInvestment,
          currency: b.currency ?? 'USD',
          status: b.status ?? 'active',
          metadata: b.metadata,
          financialModel: b.financialModel,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putAsset(asset)
        await publishDomainEvent(BUS, 'apip.service', {
          tenantId: ctx.tenantId,
          type: 'AssetCreated',
          payload: { assetId: asset.id },
        })
        return json(201, asset)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[2] && seg.length === 3) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return jsonError(404, 'NOT_FOUND', 'Activo no encontrado')
        return json(200, a)
      }
      if (method === 'PATCH') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return jsonError(404, 'NOT_FOUND', 'Activo no encontrado')
        const body = patchAssetBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const touchesStructuralFields =
          body.data.type !== undefined ||
          body.data.acquisitionDate !== undefined ||
          body.data.initialInvestment !== undefined ||
          body.data.currency !== undefined
        if (touchesStructuralFields) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
          const cost = await repo.listCostFacts(ctx.tenantId, assetId)
          if (rev.length > 0 || cost.length > 0) {
            return jsonError(
              409,
              'MODEL_LOCKED',
              'No se pueden cambiar type/acquisitionDate/initialInvestment/currency cuando ya existen hechos operativos para el activo',
            )
          }
        }
        const now = new Date().toISOString()
        const updated: Asset = {
          ...a,
          ...body.data,
          updatedAt: now,
        }
        await repo.putAsset(updated)
        return json(200, updated)
      }
      if (method === 'DELETE') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return jsonError(404, 'NOT_FOUND', 'Activo no encontrado')
        await repo.deleteFactsForAsset(ctx.tenantId, assetId)
        await repo.deleteAssetItem(ctx.tenantId, assetId)
        await publishDomainEvent(BUS, 'apip.service', {
          tenantId: ctx.tenantId,
          type: 'AssetDeleted',
          payload: { assetId },
        })
        return noContent()
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'metrics' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return jsonError(404, 'NOT_FOUND', 'Activo no encontrado')
        const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const cost = await repo.listCostFacts(ctx.tenantId, assetId)
        const metrics = computeAssetMetrics(a, rev, cost)
        return json(200, metrics)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'cashflow' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return jsonError(404, 'NOT_FOUND', 'Activo no encontrado')
        const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const cost = await repo.listCostFacts(ctx.tenantId, assetId)
        const metrics = computeAssetMetrics(a, rev, cost)
        return json(200, { assetId, cashFlow: metrics.cashFlow })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'cash-flows' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'PUT') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return jsonError(404, 'NOT_FOUND', 'Activo no encontrado')
        const body = putAssetCashFlowsBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const src = (s: string | undefined): RevenueFact['source'] => {
          if (s === 'import' || s === 'api') return s
          if (s === 'tms' || s === 'erp') return 'api'
          return 'manual'
        }
        for (const p of body.data.periods) {
          const iso = `${p.period}-01T00:00:00.000Z`
          const rid = `m-${p.period}-rev`
          const cid = `m-${p.period}-cost`
          const rf: RevenueFact = {
            id: rid,
            tenantId: ctx.tenantId,
            assetId,
            date: iso,
            amount: p.revenue,
            category: 'monthly',
            source: src(p.source),
            createdAt: now,
          }
          const cf: CostFact = {
            id: cid,
            tenantId: ctx.tenantId,
            assetId,
            date: iso,
            amount: p.cost,
            category: 'operational',
            source: src(p.source),
            createdAt: now,
          }
          await repo.putRevenueFact(rf)
          await repo.putCostFact(cf)
        }
        const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const cost = await repo.listCostFacts(ctx.tenantId, assetId)
        const metrics = computeAssetMetrics(a, rev, cost)
        return json(200, { assetId, updatedPeriods: body.data.periods.length, metrics })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'structure' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return jsonError(404, 'NOT_FOUND', 'Activo no encontrado')
        const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const cost = await repo.listCostFacts(ctx.tenantId, assetId)
        const metrics = computeAssetMetrics(a, rev, cost)
        const { lines, operatingIncome } = buildStandardizedStructure(metrics, rev, cost)
        return json(200, { assetId, lines, operatingIncome, ebitda: metrics.ebitda, netProfit: metrics.netProfit })
      }
    }

    // --- portfolios ---
    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg.length === 2) {
      if (method === 'GET') {
        const items = await repo.listPortfolios(ctx.tenantId)
        return json(200, { items })
      }
      if (method === 'POST') {
        const body = createPortfolioBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const p: Portfolio = {
          id: newId.portfolio(),
          tenantId: ctx.tenantId,
          name: body.data.name,
          strategy: body.data.strategy,
          baseCurrency: body.data.baseCurrency,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putPortfolio(p)
        return json(201, p)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[2] && seg.length === 3) {
      const id = seg[2]
      if (method === 'GET') {
        const p = await repo.getPortfolio(ctx.tenantId, id)
        if (!p) return jsonError(404, 'NOT_FOUND', 'Portfolio no encontrado')
        return json(200, p)
      }
      if (method === 'PATCH') {
        const p = await repo.getPortfolio(ctx.tenantId, id)
        if (!p) return jsonError(404, 'NOT_FOUND', 'Portfolio no encontrado')
        const body = patchPortfolioBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: Portfolio = {
          ...p,
          ...body.data,
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          updatedAt: now,
        }
        await repo.putPortfolio(updated)
        return json(200, updated)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[3] === 'metrics' && seg.length === 4) {
      const portfolioId = seg[2]
      if (method === 'GET') {
        const a = await repo.listAssetsByTenant(ctx.tenantId, { portfolioId })
        const metricsList = []
        for (const asset of a) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          metricsList.push(computeAssetMetrics(asset, rev, cost))
        }
        return json(200, { portfolioId, assets: metricsList })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[3] === 'cashflow' && seg.length === 4) {
      const portfolioId = seg[2]
      if (method === 'GET') {
        const a = await repo.listAssetsByTenant(ctx.tenantId, { portfolioId })
        const series = []
        for (const asset of a) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = computeAssetMetrics(asset, rev, cost)
          series.push({ assetId: asset.id, cashFlow: m.cashFlow })
        }
        return json(200, { portfolioId, series })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[3] === 'performance' && seg.length === 4) {
      const portfolioId = seg[2]
      if (method === 'GET') {
        const a = await repo.listAssetsByTenant(ctx.tenantId, { portfolioId })
        const totalCap = a.reduce((s, x) => s + x.initialInvestment, 0)
        let weightedRoi = 0
        for (const asset of a) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = computeAssetMetrics(asset, rev, cost)
          const w = totalCap > 0 ? asset.initialInvestment / totalCap : 0
          weightedRoi += m.roi * w
        }
        return json(200, { portfolioId, totalCapitalDeployed: totalCap, weightedROI: weightedRoi })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[3] === 'capital-participation' && seg.length === 4) {
      const portfolioId = seg[2]
      if (method === 'GET') {
        const view = await buildPortfolioCapitalParticipation(ctx.tenantId, portfolioId)
        if (!view) return jsonError(404, 'NOT_FOUND', 'Portfolio no encontrado')
        return json(200, view)
      }
    }

    // --- projects ---
    if (seg[0] === 'v1' && seg[1] === 'projects' && seg.length === 2) {
      if (method === 'GET') {
        const q = event.queryStringParameters?.portfolioId
        const items = await repo.listProjects(ctx.tenantId, q)
        return json(200, { items })
      }
      if (method === 'POST') {
        const body = createProjectBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const pf = await repo.getPortfolio(ctx.tenantId, body.data.portfolioId)
        if (!pf) return jsonError(400, 'VALIDATION', 'portfolioId no existe')
        const now = new Date().toISOString()
        const p: Project = {
          id: newId.project(),
          tenantId: ctx.tenantId,
          portfolioId: body.data.portfolioId,
          name: body.data.name,
          description: body.data.description,
          status: body.data.status ?? 'planning',
          budget: body.data.budget,
          startDate: body.data.startDate,
          endDate: body.data.endDate,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putProject(p)
        return json(201, p)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[2] && seg.length === 3) {
      const id = seg[2]
      if (method === 'GET') {
        const p = await repo.getProject(ctx.tenantId, id)
        if (!p) return jsonError(404, 'NOT_FOUND', 'Proyecto no encontrado')
        return json(200, p)
      }
      if (method === 'PATCH') {
        const p = await repo.getProject(ctx.tenantId, id)
        if (!p) return jsonError(404, 'NOT_FOUND', 'Proyecto no encontrado')
        const body = patchProjectBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: Project = {
          ...p,
          ...body.data,
          updatedAt: now,
        }
        await repo.putProject(updated)
        return json(200, updated)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[3] === 'metrics' && seg.length === 4) {
      const projectId = seg[2]
      if (method === 'GET') {
        const a = await repo.listAssetsByTenant(ctx.tenantId, { projectId })
        const metricsList = []
        for (const asset of a) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          metricsList.push(computeAssetMetrics(asset, rev, cost))
        }
        return json(200, { projectId, assets: metricsList })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[3] === 'cashflow' && seg.length === 4) {
      const projectId = seg[2]
      if (method === 'GET') {
        const a = await repo.listAssetsByTenant(ctx.tenantId, { projectId })
        const series = []
        for (const asset of a) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = computeAssetMetrics(asset, rev, cost)
          series.push({ assetId: asset.id, cashFlow: m.cashFlow })
        }
        return json(200, { projectId, series })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[3] === 'investor-allocations' && seg.length === 4) {
      const projectId = seg[2]
      if (method === 'PUT') {
        const body = putProjectInvestorAllocationsBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        try {
          await validateAndReplaceProjectAllocations(ctx.tenantId, projectId, body.data.allocations)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (
            msg.includes('ALLOC_') ||
            msg.includes('INVESTOR_NOT_FOUND') ||
            msg.includes('DUPLICATE_') ||
            msg.includes('PROJECT_NOT_FOUND')
          ) {
            return jsonError(400, 'VALIDATION', msg)
          }
          throw e
        }
        const view = await buildProjectCapitalParticipation(ctx.tenantId, projectId)
        return json(200, view)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[3] === 'capital-participation' && seg.length === 4) {
      const projectId = seg[2]
      if (method === 'GET') {
        const view = await buildProjectCapitalParticipation(ctx.tenantId, projectId)
        if (!view) return jsonError(404, 'NOT_FOUND', 'Proyecto no encontrado')
        return json(200, view)
      }
    }

    // --- dashboard / insights ---
    if (seg[0] === 'v1' && seg[1] === 'dashboard' && seg[2] === 'executive' && seg.length === 3) {
      if (method === 'GET') {
        const assets = await repo.listAssetsByTenant(ctx.tenantId, {})
        const totalCap = assets.reduce((s, x) => s + x.initialInvestment, 0)
        let totalRev = 0
        let totalCost = 0
        const rows = []
        for (const asset of assets) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = computeAssetMetrics(asset, rev, cost)
          totalRev += m.accumulatedRevenue
          totalCost += m.operatingCosts
          rows.push({
            assetId: asset.id,
            name: asset.name,
            type: asset.type,
            capital: asset.initialInvestment,
            roi: m.roi,
            irr: m.irr,
            status: asset.status,
          })
        }
        const netCashFlowYTD = totalRev - totalCost
        let wSum = 0
        for (const asset of assets) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = computeAssetMetrics(asset, rev, cost)
          wSum += m.roi * (asset.initialInvestment / (totalCap || 1))
        }
        const portfolioROI = totalCap ? (netCashFlowYTD / totalCap) * 100 : 0
        // IRR promedio simple
        let irrSum = 0
        for (const asset of assets) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = computeAssetMetrics(asset, rev, cost)
          irrSum += m.irr
        }
        const irrAvg = assets.length ? irrSum / assets.length : 0

        return json(200, {
          kpis: {
            totalCapitalDeployed: totalCap,
            portfolioROI,
            irr: irrAvg,
            netCashFlowYTD,
            assetUtilization: 0,
            riskScore: 50,
            weightedROI: wSum,
            diversificationIndex: new Set(assets.map(a => a.type)).size * 25,
          },
          assetSummary: rows,
        })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'insights' && seg.length === 2) {
      if (method === 'GET') {
        const assets = await repo.listAssetsByTenant(ctx.tenantId, {})
        const enriched = []
        for (const asset of assets) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = computeAssetMetrics(asset, rev, cost)
          enriched.push({ id: asset.id, name: asset.name, metrics: m })
        }
        return json(200, { items: buildInsights(ctx.tenantId, enriched) })
      }
    }

    // --- reports (JSON para UI y exportación CSV en cliente) ---
    if (seg[0] === 'v1' && seg[1] === 'reports' && seg.length === 3) {
      const kind = seg[2]
      if (method === 'GET') {
        if (kind === 'investment-summary') {
          const rep = await buildInvestmentSummaryReport(ctx.tenantId)
          return json(200, rep)
        }
        if (kind === 'asset-register') {
          const rep = await buildAssetRegisterReport(ctx.tenantId)
          return json(200, rep)
        }
        if (kind === 'portfolio-snapshot') {
          const rep = await buildPortfolioSnapshotReport(ctx.tenantId)
          return json(200, rep)
        }
      }
    }

    // --- investors ---
    if (seg[0] === 'v1' && seg[1] === 'investors' && seg.length === 2) {
      if (method === 'GET') {
        const items = await repo.listInvestors(ctx.tenantId)
        return json(200, { items })
      }
      if (method === 'POST') {
        const body = createInvestorBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const inv: Investor = {
          id: newId.investor(),
          tenantId: ctx.tenantId,
          name: body.data.name,
          role: body.data.role,
          email: body.data.email,
          portfolioIds: body.data.portfolioIds ?? [],
          committedCapital: body.data.committedCapital,
          notes: body.data.notes,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putInvestor(inv)
        return json(201, inv)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg.length === 3) {
      const investorId = seg[2]
      if (method === 'GET') {
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return jsonError(404, 'NOT_FOUND', 'Inversionista no encontrado')
        return json(200, inv)
      }
      if (method === 'PATCH') {
        const existing = await repo.getInvestor(ctx.tenantId, investorId)
        if (!existing) return jsonError(404, 'NOT_FOUND', 'Inversionista no encontrado')
        const body = patchInvestorBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: Investor = { ...existing, ...body.data, updatedAt: now }
        await repo.putInvestor(updated)
        return json(200, updated)
      }
      if (method === 'DELETE') {
        const existing = await repo.getInvestor(ctx.tenantId, investorId)
        if (!existing) return jsonError(404, 'NOT_FOUND', 'Inversionista no encontrado')
        await repo.deleteInvestor(ctx.tenantId, investorId)
        return noContent()
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg[3] === 'ledger' && seg.length === 4) {
      const investorId = seg[2]
      if (method === 'GET') {
        const entries = await repo.listInvestorLedgerEntries(ctx.tenantId, investorId)
        const items = [...entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        return json(200, { items })
      }
      if (method === 'POST') {
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return jsonError(404, 'NOT_FOUND', 'Inversionista no encontrado')
        const body = investorLedgerEntryBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const entry: InvestorLedgerEntry = {
          id: newId.ledgerEntry(),
          tenantId: ctx.tenantId,
          investorId,
          type: body.data.type,
          amount: body.data.amount,
          occurredAt: body.data.occurredAt,
          note: body.data.note,
          createdAt: now,
        }
        await repo.putInvestorLedgerEntry(entry)
        return json(201, entry)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg[3] === 'capital-account' && seg.length === 4) {
      const investorId = seg[2]
      if (method === 'GET') {
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return jsonError(404, 'NOT_FOUND', 'Inversionista no encontrado')
        const acc = await buildInvestorCapitalAccount(ctx.tenantId, inv)
        return json(200, acc)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg[3] === 'exposure' && seg.length === 4) {
      const investorId = seg[2]
      if (method === 'GET') {
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return jsonError(404, 'NOT_FOUND', 'Inversionista no encontrado')
        const exp = await buildInvestorExposure(ctx.tenantId, inv)
        return json(200, exp)
      }
    }

    // --- imports ---
    if (seg[0] === 'v1' && seg[1] === 'imports' && seg[2] === 'assets' && seg.length === 3) {
      if (method === 'POST') {
        const body = importAssetsBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const b = body.data

        if (b.rows && b.rows.length > 0) {
          const now = new Date().toISOString()
          const job: ImportJob = {
            id: newId.importJob(),
            tenantId: ctx.tenantId,
            status: 'PROCESSING',
            fileKey: b.fileName ?? 'inline-rows',
            templateVersion: b.templateVersion,
            totalRows: b.rows.length,
            createdAt: now,
            updatedAt: now,
          }
          await repo.putImportJob(job)
          const created: Asset[] = []
          const errors: { index: number; message: string }[] = []
          for (let i = 0; i < b.rows.length; i++) {
            const row = b.rows[i]
            try {
              const pf = await repo.getPortfolio(ctx.tenantId, row.portfolioId)
              if (!pf) throw new Error('portfolioId no existe')
              const pj = await repo.getProject(ctx.tenantId, row.projectId)
              if (!pj || pj.portfolioId !== row.portfolioId) {
                throw new Error('projectId no existe o no pertenece al portfolio')
              }
              const asset: Asset = {
                id: newId.asset(),
                tenantId: ctx.tenantId,
                portfolioId: row.portfolioId,
                projectId: row.projectId,
                name: row.name,
                type: row.type,
                acquisitionDate: row.acquisitionDate,
                initialInvestment: row.initialInvestment,
                currency: row.currency ?? 'USD',
                status: row.status ?? 'active',
                metadata: row.metadata,
                financialModel: row.financialModel,
                createdAt: now,
                updatedAt: now,
              }
              await repo.putAsset(asset)
              await publishDomainEvent(BUS, 'apip.service', {
                tenantId: ctx.tenantId,
                type: 'AssetCreated',
                payload: { assetId: asset.id },
              })
              created.push(asset)
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              errors.push({ index: i, message: msg })
            }
          }
          const okRows = created.length
          const errorRows = errors.length
          const finalStatus: ImportJob['status'] =
            errorRows === 0 ? 'COMPLETED' : okRows === 0 ? 'FAILED' : 'PARTIAL'
          await repo.putImportJob({
            ...job,
            status: finalStatus,
            okRows,
            errorRows,
            updatedAt: new Date().toISOString(),
          })
          return json(200, {
            jobId: job.id,
            status: finalStatus,
            created,
            errors,
          })
        }

        const now = new Date().toISOString()
        const job: ImportJob = {
          id: newId.importJob(),
          tenantId: ctx.tenantId,
          status: 'PENDING',
          fileKey: b.fileName!,
          templateVersion: b.templateVersion,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putImportJob(job)
        return json(202, { jobId: job.id, status: job.status })
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'imports' && seg[2] === 'assets' && seg[3] && seg.length === 4) {
      const jobId = seg[3]
      if (method === 'GET') {
        const j = await repo.getImportJob(ctx.tenantId, jobId)
        if (!j) return jsonError(404, 'NOT_FOUND', 'Job no encontrado')
        return json(200, j)
      }
    }

    // --- simulations ---
    if (seg[0] === 'v1' && seg[1] === 'simulations' && seg.length === 2) {
      if (method === 'GET') {
        const items = await repo.listSimulations(ctx.tenantId)
        return json(200, { items })
      }
      if (method === 'POST') {
        const body = simulationBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const b = body.data
        const now = new Date().toISOString()
        const id = newId.simulation()
        const projection = computeSimulationProjection(b)
        const simulation: Simulation = {
          id,
          tenantId: ctx.tenantId,
          name: b.name,
          assetType: b.assetType,
          initialCapital: b.initialCapital,
          expectedMonthlyRevenue: b.expectedMonthlyRevenue,
          expectedOperatingCost: b.expectedOperatingCost,
          growthRatePercent: b.growthRatePercent,
          durationMonths: b.durationMonths,
          discountRateAnnual: b.discountRateAnnual,
          projectedROI: projection.roi,
          projectedIRR: projection.irr,
          projectedNPV: projection.npv,
          breakEvenMonth: projection.breakEvenMonth,
          calculationVersion: CALCULATION_VERSION,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putSimulation(simulation)
        return json(201, simulation)
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'simulations' && seg[2] && seg.length === 3) {
      const simulationId = seg[2]
      if (method === 'GET') {
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return jsonError(404, 'NOT_FOUND', 'Simulación no encontrada')
        return json(200, sim)
      }
      if (method === 'PATCH') {
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return jsonError(404, 'NOT_FOUND', 'Simulación no encontrada')
        const body = patchSimulationBody.safeParse(parseBody(event.body))
        if (!body.success) return jsonError(400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const merged = { ...sim, ...body.data }
        const projection = computeSimulationProjection({
          initialCapital: merged.initialCapital,
          expectedMonthlyRevenue: merged.expectedMonthlyRevenue,
          expectedOperatingCost: merged.expectedOperatingCost,
          growthRatePercent: merged.growthRatePercent,
          durationMonths: merged.durationMonths,
          discountRateAnnual: merged.discountRateAnnual,
        })
        const updated: Simulation = {
          ...merged,
          projectedROI: projection.roi,
          projectedIRR: projection.irr,
          projectedNPV: projection.npv,
          breakEvenMonth: projection.breakEvenMonth,
          calculationVersion: CALCULATION_VERSION,
          updatedAt: new Date().toISOString(),
        }
        await repo.putSimulation(updated)
        return json(200, updated)
      }
      if (method === 'DELETE') {
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return jsonError(404, 'NOT_FOUND', 'Simulación no encontrada')
        await repo.deleteSimulation(ctx.tenantId, simulationId)
        return noContent()
      }
    }

    // --- alerts ---
    if (seg[0] === 'v1' && seg[1] === 'alerts' && seg.length === 2) {
      if (method === 'GET') {
        return json(200, { items: [] })
      }
    }

    return jsonError(404, 'NOT_FOUND', `Ruta no implementada: ${method} ${path}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(e)
    return jsonError(500, 'INTERNAL', msg)
  }
}
