import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { resolvePlatformAdmin, resolveRequestContext } from '../auth/context'
import * as accessRepo from '../repositories/access-repository'
import * as repo from '../repositories/core-repository'
import {
  createAccessRoleBody,
  createAssetBody,
  createInvestorBody,
  createPortfolioBody,
  createProjectBody,
  createTenantBody,
  createTmsCustomerBody,
  createTmsDriverBody,
  createTmsLocalityBody,
  createTmsProviderBody,
  createTmsRateBody,
  createTmsRouteBody,
  createTmsVehicleUnitBody,
  createTransportOrderBody,
  createTransportTripBody,
  importTmsOrderTripsBody,
  importTmsRatesBody,
  importAssetsBody,
  investorLedgerEntryBody,
  listQuery,
  patchAccessRoleBody,
  putSelfUserProfileBody,
  patchAssetBody,
  patchInvestorBody,
  patchPortfolioBody,
  patchProjectBody,
  patchTenantBody,
  patchSimulationBody,
  patchTmsCustomerBody,
  patchTmsLocalityBody,
  patchTmsProviderBody,
  patchTransportOrderBody,
  patchTransportTripBody,
  putAssetCashFlowsBody,
  putProjectInvestorAllocationsBody,
  simulationBody,
  tmsTripCostBody,
  tmsTripRevenueBody,
} from '../domain/schemas'
import { COST_CATEGORY_CATALOG } from '../domain/cost-categories'
import { PERMISSION_KEYS } from '../domain/permission-keys'
import { auditedJsonError, finalizeAudit, finalizePlatformAudit } from '../lib/audit'
import { json, noContent } from '../lib/http'
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
import {
  buildTmsSummary,
  isKnownCostCategory,
  requireTransportAsset,
  resolveTmsRateForOrder,
  resolveTripAssignmentDenorm,
  resolveTransportOrderDenorm,
} from '../services/tms'
import type {
  AccessRole,
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
  TenantUserProfile,
  TmsCustomer,
  TmsDriver,
  TmsLocality,
  TmsRate,
  TmsRoute,
  TmsTransportProvider,
  TmsVehicleUnit,
  TransportOrder,
  TransportTrip,
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

function validatePermissionKeys(keys: string[]): string | null {
  const allowed = new Set<string>([...PERMISSION_KEYS])
  for (const k of keys) {
    if (!allowed.has(k)) return `Permiso no reconocido: ${k}`
  }
  return null
}

async function ensureTenant(
  ctx: { tenantId: string; subject?: string },
  event: APIGatewayProxyEventV2,
  tenantId: string,
): Promise<APIGatewayProxyResultV2 | null> {
  const t = await repo.getTenant(tenantId)
  if (!t) return auditedJsonError(ctx, event, 404, 'TENANT_NOT_FOUND', 'Tenant no existe o no está inicializado')
  return null
}

async function routeAdmin(
  event: APIGatewayProxyEventV2,
  method: string,
  seg: string[],
  adminCtx: { tenantId: string; subject: string },
): Promise<APIGatewayProxyResultV2> {
  if (seg[2] === 'tenants' && seg.length === 3) {
    if (method === 'GET') {
      const items = await repo.listTenants()
      return finalizePlatformAudit(event, adminCtx.subject, json(200, { items }))
    }
    if (method === 'POST') {
      const body = createTenantBody.safeParse(parseBody(event.body))
      if (!body.success)
        return auditedJsonError(adminCtx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      const now = new Date().toISOString()
      const id = body.data.id ?? newId.tenant()
      const t: Tenant = {
        id,
        name: body.data.name,
        type: body.data.type,
        createdAt: now,
      }
      await repo.putTenant(t)
      return finalizePlatformAudit(event, adminCtx.subject, json(201, t))
    }
  }
  if (seg[2] === 'tenants' && seg[3] && seg.length === 4) {
    const tenantId = seg[3]
    if (method === 'GET') {
      const t = await repo.getTenant(tenantId)
      if (!t) return auditedJsonError(adminCtx, event, 404, 'NOT_FOUND', 'Tenant no encontrado')
      return finalizePlatformAudit(event, adminCtx.subject, json(200, t))
    }
    if (method === 'PATCH') {
      const existing = await repo.getTenant(tenantId)
      if (!existing) return auditedJsonError(adminCtx, event, 404, 'NOT_FOUND', 'Tenant no encontrado')
      const body = patchTenantBody.safeParse(parseBody(event.body))
      if (!body.success)
        return auditedJsonError(adminCtx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      const t: Tenant = {
        ...existing,
        ...body.data,
      }
      await repo.putTenant(t)
      return finalizePlatformAudit(event, adminCtx.subject, json(200, t))
    }
  }
  return auditedJsonError(adminCtx, event, 404, 'NOT_FOUND', `Ruta admin no implementada: ${method}`)
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
      return auditedJsonError(undefined, event, 403, 'FORBIDDEN', 'Se requiere rol de administrador de plataforma (grupo Cognito o custom:platformAdmin)')
    }
    const adminCtx = { tenantId: '_platform_', subject: admin.subject }
    try {
      return await routeAdmin(event, method, seg, adminCtx)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(e)
      return auditedJsonError(adminCtx, event, 500, 'INTERNAL', msg)
    }
  }

  let ctx: ReturnType<typeof resolveRequestContext>
  try {
    ctx = resolveRequestContext(event)
  } catch {
    return auditedJsonError(undefined, event, 401, 'UNAUTHORIZED', 'No se pudo resolver tenantId (JWT o cabecera X-Tenant-Id en dev)')
  }

  const err = await ensureTenant(ctx, event, ctx.tenantId)
  if (err) return err

  try {
    // --- /v1/assets ---
    if (seg[0] === 'v1' && seg[1] === 'assets' && seg.length === 2) {
      if (method === 'GET') {
        const q = listQuery.safeParse(event.queryStringParameters ?? {})
        if (!q.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Query inválida', q.error.flatten())
        const assets = await repo.listAssetsByTenant(ctx.tenantId, {
          projectId: q.data.projectId,
          portfolioId: q.data.portfolioId,
          type: q.data.type,
        })
        return finalizeAudit(ctx, event, json(200, { items: assets, nextCursor: null }))
      }
      if (method === 'POST') {
        const body = createAssetBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const b = body.data
        const pf = await repo.getPortfolio(ctx.tenantId, b.portfolioId)
        if (!pf) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'portfolioId no existe')
        const pj = await repo.getProject(ctx.tenantId, b.projectId)
        if (!pj || pj.portfolioId !== b.portfolioId) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'projectId no existe o no pertenece al portfolio')
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
        return finalizeAudit(ctx, event, json(201, asset))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[2] && seg.length === 3) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        return finalizeAudit(ctx, event, json(200, a))
      }
      if (method === 'PATCH') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const body = patchAssetBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const touchesStructuralFields =
          body.data.type !== undefined ||
          body.data.acquisitionDate !== undefined ||
          body.data.initialInvestment !== undefined ||
          body.data.currency !== undefined
        if (touchesStructuralFields) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
          const cost = await repo.listCostFacts(ctx.tenantId, assetId)
          if (rev.length > 0 || cost.length > 0) {
            return auditedJsonError(ctx, event,
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
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        await repo.deleteFactsForAsset(ctx.tenantId, assetId)
        await repo.deleteAssetItem(ctx.tenantId, assetId)
        await publishDomainEvent(BUS, 'apip.service', {
          tenantId: ctx.tenantId,
          type: 'AssetDeleted',
          payload: { assetId },
        })
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'metrics' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const cost = await repo.listCostFacts(ctx.tenantId, assetId)
        const metrics = computeAssetMetrics(a, rev, cost)
        return finalizeAudit(ctx, event, json(200, metrics))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'cashflow' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const cost = await repo.listCostFacts(ctx.tenantId, assetId)
        const metrics = computeAssetMetrics(a, rev, cost)
        return finalizeAudit(ctx, event, json(200, { assetId, cashFlow: metrics.cashFlow }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'facts' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const revenueFacts = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const costFacts = await repo.listCostFacts(ctx.tenantId, assetId)
        return finalizeAudit(ctx, event, json(200, { assetId, revenueFacts, costFacts }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'cash-flows' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'PUT') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const body = putAssetCashFlowsBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
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
        return finalizeAudit(ctx, event, json(200, { assetId, updatedPeriods: body.data.periods.length, metrics }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'structure' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const cost = await repo.listCostFacts(ctx.tenantId, assetId)
        const metrics = computeAssetMetrics(a, rev, cost)
        const { lines, operatingIncome } = buildStandardizedStructure(metrics, rev, cost)
        return finalizeAudit(ctx, event, json(200, { assetId, lines, operatingIncome, ebitda: metrics.ebitda, netProfit: metrics.netProfit }))
      }
    }

    // --- access (roles + perfiles; usuario enlazado por cognito sub del JWT) ---
    if (seg[0] === 'v1' && seg[1] === 'access' && seg[2] === 'roles' && seg.length === 3) {
      if (method === 'GET') {
        const items = await accessRepo.listAccessRoles(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createAccessRoleBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const permErr = validatePermissionKeys(body.data.permissionKeys)
        if (permErr) return auditedJsonError(ctx, event, 400, 'VALIDATION', permErr)
        const now = new Date().toISOString()
        const role: AccessRole = {
          id: newId.accessRole(),
          tenantId: ctx.tenantId,
          name: body.data.name,
          description: body.data.description,
          permissionKeys: body.data.permissionKeys,
          createdAt: now,
          updatedAt: now,
        }
        await accessRepo.putAccessRole(role)
        return finalizeAudit(ctx, event, json(201, role))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'access' && seg[2] === 'roles' && seg[3] && seg.length === 4) {
      const roleId = seg[3]
      if (method === 'GET') {
        const role = await accessRepo.getAccessRole(ctx.tenantId, roleId)
        if (!role) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Rol no encontrado')
        return finalizeAudit(ctx, event, json(200, role))
      }
      if (method === 'PATCH') {
        const existing = await accessRepo.getAccessRole(ctx.tenantId, roleId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Rol no encontrado')
        const body = patchAccessRoleBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        if (body.data.permissionKeys) {
          const permErr = validatePermissionKeys(body.data.permissionKeys)
          if (permErr) return auditedJsonError(ctx, event, 400, 'VALIDATION', permErr)
        }
        const now = new Date().toISOString()
        const updated: AccessRole = {
          ...existing,
          ...body.data,
          updatedAt: now,
        }
        await accessRepo.putAccessRole(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        const existing = await accessRepo.getAccessRole(ctx.tenantId, roleId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Rol no encontrado')
        await accessRepo.deleteAccessRole(ctx.tenantId, roleId)
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'access' && seg[2] === 'users' && seg.length === 3) {
      if (method === 'GET') {
        const items = await accessRepo.listTenantUserProfiles(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'access' && seg[2] === 'me' && seg.length === 3) {
      const sub = ctx.subject
      if (!sub) return auditedJsonError(ctx, event, 401, 'UNAUTHORIZED', 'Token sin subject (sub)')
      if (method === 'GET') {
        const p = await accessRepo.getTenantUserProfile(ctx.tenantId, sub)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Perfil no registrado; use PUT para crearlo')
        return finalizeAudit(ctx, event, json(200, p))
      }
      if (method === 'PUT') {
        const body = putSelfUserProfileBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const existing = await accessRepo.getTenantUserProfile(ctx.tenantId, sub)
        const profile: TenantUserProfile = existing
          ? {
              ...existing,
              ...body.data,
              updatedAt: now,
            }
          : {
              tenantId: ctx.tenantId,
              cognitoSub: sub,
              roleIds: [],
              ...body.data,
              createdAt: now,
              updatedAt: now,
            }
        await accessRepo.putTenantUserProfile(profile)
        return finalizeAudit(ctx, event, json(200, profile))
      }
    }

    // --- portfolios ---
    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg.length === 2) {
      if (method === 'GET') {
        const items = await repo.listPortfolios(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createPortfolioBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
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
        return finalizeAudit(ctx, event, json(201, p))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[2] && seg.length === 3) {
      const id = seg[2]
      if (method === 'GET') {
        const p = await repo.getPortfolio(ctx.tenantId, id)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Portfolio no encontrado')
        return finalizeAudit(ctx, event, json(200, p))
      }
      if (method === 'PATCH') {
        const p = await repo.getPortfolio(ctx.tenantId, id)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Portfolio no encontrado')
        const body = patchPortfolioBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: Portfolio = {
          ...p,
          ...body.data,
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          updatedAt: now,
        }
        await repo.putPortfolio(updated)
        return finalizeAudit(ctx, event, json(200, updated))
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
        return finalizeAudit(ctx, event, json(200, { portfolioId, assets: metricsList }))
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
        return finalizeAudit(ctx, event, json(200, { portfolioId, series }))
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
        return finalizeAudit(ctx, event, json(200, { portfolioId, totalCapitalDeployed: totalCap, weightedROI: weightedRoi }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[3] === 'capital-participation' && seg.length === 4) {
      const portfolioId = seg[2]
      if (method === 'GET') {
        const view = await buildPortfolioCapitalParticipation(ctx.tenantId, portfolioId)
        if (!view) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Portfolio no encontrado')
        return finalizeAudit(ctx, event, json(200, view))
      }
    }

    // --- projects ---
    if (seg[0] === 'v1' && seg[1] === 'projects' && seg.length === 2) {
      if (method === 'GET') {
        const q = event.queryStringParameters?.portfolioId
        const items = await repo.listProjects(ctx.tenantId, q)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createProjectBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const pf = await repo.getPortfolio(ctx.tenantId, body.data.portfolioId)
        if (!pf) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'portfolioId no existe')
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
        return finalizeAudit(ctx, event, json(201, p))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[2] && seg.length === 3) {
      const id = seg[2]
      if (method === 'GET') {
        const p = await repo.getProject(ctx.tenantId, id)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        return finalizeAudit(ctx, event, json(200, p))
      }
      if (method === 'PATCH') {
        const p = await repo.getProject(ctx.tenantId, id)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        const body = patchProjectBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: Project = {
          ...p,
          ...body.data,
          updatedAt: now,
        }
        await repo.putProject(updated)
        return finalizeAudit(ctx, event, json(200, updated))
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
        return finalizeAudit(ctx, event, json(200, { projectId, assets: metricsList }))
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
        return finalizeAudit(ctx, event, json(200, { projectId, series }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[3] === 'investor-allocations' && seg.length === 4) {
      const projectId = seg[2]
      if (method === 'PUT') {
        const body = putProjectInvestorAllocationsBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
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
            return auditedJsonError(ctx, event, 400, 'VALIDATION', msg)
          }
          throw e
        }
        const view = await buildProjectCapitalParticipation(ctx.tenantId, projectId)
        return finalizeAudit(ctx, event, json(200, view))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[3] === 'capital-participation' && seg.length === 4) {
      const projectId = seg[2]
      if (method === 'GET') {
        const view = await buildProjectCapitalParticipation(ctx.tenantId, projectId)
        if (!view) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        return finalizeAudit(ctx, event, json(200, view))
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

        return finalizeAudit(ctx, event, json(200, {
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
        }))
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
        return finalizeAudit(ctx, event, json(200, { items: buildInsights(ctx.tenantId, enriched) }))
      }
    }

    // --- reports (JSON para UI y exportación CSV en cliente) ---
    if (seg[0] === 'v1' && seg[1] === 'reports' && seg.length === 3) {
      const kind = seg[2]
      if (method === 'GET') {
        if (kind === 'investment-summary') {
          const rep = await buildInvestmentSummaryReport(ctx.tenantId)
          return finalizeAudit(ctx, event, json(200, rep))
        }
        if (kind === 'asset-register') {
          const rep = await buildAssetRegisterReport(ctx.tenantId)
          return finalizeAudit(ctx, event, json(200, rep))
        }
        if (kind === 'portfolio-snapshot') {
          const rep = await buildPortfolioSnapshotReport(ctx.tenantId)
          return finalizeAudit(ctx, event, json(200, rep))
        }
      }
    }

    // --- investors ---
    if (seg[0] === 'v1' && seg[1] === 'investors' && seg.length === 2) {
      if (method === 'GET') {
        const items = await repo.listInvestors(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createInvestorBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
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
        return finalizeAudit(ctx, event, json(201, inv))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg.length === 3) {
      const investorId = seg[2]
      if (method === 'GET') {
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        return finalizeAudit(ctx, event, json(200, inv))
      }
      if (method === 'PATCH') {
        const existing = await repo.getInvestor(ctx.tenantId, investorId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        const body = patchInvestorBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: Investor = { ...existing, ...body.data, updatedAt: now }
        await repo.putInvestor(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        const existing = await repo.getInvestor(ctx.tenantId, investorId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        await repo.deleteInvestor(ctx.tenantId, investorId)
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg[3] === 'ledger' && seg.length === 4) {
      const investorId = seg[2]
      if (method === 'GET') {
        const entries = await repo.listInvestorLedgerEntries(ctx.tenantId, investorId)
        const items = [...entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        const body = investorLedgerEntryBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
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
        return finalizeAudit(ctx, event, json(201, entry))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg[3] === 'capital-account' && seg.length === 4) {
      const investorId = seg[2]
      if (method === 'GET') {
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        const acc = await buildInvestorCapitalAccount(ctx.tenantId, inv)
        return finalizeAudit(ctx, event, json(200, acc))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg[3] === 'exposure' && seg.length === 4) {
      const investorId = seg[2]
      if (method === 'GET') {
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        const exp = await buildInvestorExposure(ctx.tenantId, inv)
        return finalizeAudit(ctx, event, json(200, exp))
      }
    }

    // --- imports ---
    if (seg[0] === 'v1' && seg[1] === 'imports' && seg[2] === 'assets' && seg.length === 3) {
      if (method === 'POST') {
        const body = importAssetsBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
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
          return finalizeAudit(ctx, event, json(200, {
            jobId: job.id,
            status: finalStatus,
            created,
            errors,
          }))
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
        return finalizeAudit(ctx, event, json(202, { jobId: job.id, status: job.status }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'imports' && seg[2] === 'assets' && seg[3] && seg.length === 4) {
      const jobId = seg[3]
      if (method === 'GET') {
        const j = await repo.getImportJob(ctx.tenantId, jobId)
        if (!j) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Job no encontrado')
        return finalizeAudit(ctx, event, json(200, j))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'imports' && seg[2] === 'tms-rates' && seg.length === 3) {
      if (method === 'POST') {
        const body = importTmsRatesBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        if (!body.data.rows || body.data.rows.length === 0) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Para MVP usa rows inline (Excel se procesa en front)')
        }
        const now = new Date().toISOString()
        const created: TmsRate[] = []
        const errors: { index: number; message: string }[] = []
        for (let i = 0; i < body.data.rows.length; i++) {
          const row = body.data.rows[i]
          try {
            const [customer, origin, destination, provider] = await Promise.all([
              repo.getTmsCustomer(ctx.tenantId, row.customerId),
              repo.getTmsLocality(ctx.tenantId, row.originLocalityId),
              repo.getTmsLocality(ctx.tenantId, row.destinationLocalityId),
              repo.getTmsProvider(ctx.tenantId, row.providerId),
            ])
            if (!customer || !origin || !destination || !provider) throw new Error('Referencias inválidas')
            const rate: TmsRate = {
              id: newId.tmsRate(),
              tenantId: ctx.tenantId,
              customerId: row.customerId,
              originLocalityId: row.originLocalityId,
              destinationLocalityId: row.destinationLocalityId,
              providerId: row.providerId,
              buyPrice: row.buyPrice,
              sellPrice: row.sellPrice,
              currency: (row.currency ?? 'USD').toUpperCase(),
              validFrom: row.validFrom,
              validTo: row.validTo,
              isActive: row.isActive ?? true,
              notes: row.notes,
              createdAt: now,
              updatedAt: now,
            }
            await repo.putTmsRate(rate)
            created.push(rate)
          } catch (e) {
            errors.push({ index: i, message: e instanceof Error ? e.message : String(e) })
          }
        }
        return finalizeAudit(ctx, event, json(200, { createdCount: created.length, errorCount: errors.length, errors }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'imports' && seg[2] === 'tms-order-trips' && seg.length === 3) {
      if (method === 'POST') {
        const body = importTmsOrderTripsBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        if (!body.data.rows || body.data.rows.length === 0) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Para MVP usa rows inline (Excel se procesa en front)')
        }
        const now = new Date().toISOString()
        const errors: { index: number; message: string }[] = []
        const createdOrders: TransportOrder[] = []
        const createdTrips: TransportTrip[] = []
        for (let i = 0; i < body.data.rows.length; i++) {
          const row = body.data.rows[i]
          try {
            const denorm = await resolveTransportOrderDenorm(ctx.tenantId, {
              customerId: row.customerId,
              originLocalityId: row.originLocalityId,
              destinationLocalityId: row.destinationLocalityId,
              providerId: row.providerId,
            })
            const rate = await resolveTmsRateForOrder(ctx.tenantId, {
              customerId: row.customerId,
              originLocalityId: row.originLocalityId,
              destinationLocalityId: row.destinationLocalityId,
              providerId: row.providerId,
              atIso: row.scheduledDate,
            })
            const order: TransportOrder = {
              id: newId.tmsOrder(),
              tenantId: ctx.tenantId,
              customerId: row.customerId,
              originLocalityId: row.originLocalityId,
              destinationLocalityId: row.destinationLocalityId,
              customerName: denorm.customerName,
              originLabel: denorm.originLabel,
              destinationLabel: denorm.destinationLabel,
              packageCount: row.packageCount,
              providerId: row.providerId,
              providerName: denorm.providerName,
              rateId: rate.id,
              sellPrice: rate.sellPrice,
              buyPrice: rate.buyPrice,
              currency: rate.currency,
              marginAmount: rate.sellPrice - rate.buyPrice,
              cargoDescription: row.cargoDescription,
              scheduledDate: row.scheduledDate,
              status: row.orderStatus ?? 'CREATED',
              createdAt: now,
              updatedAt: now,
            }
            await repo.putTransportOrder(order)
            const denormTrip = await resolveTripAssignmentDenorm(ctx.tenantId, {
              providerId: row.providerId,
              driverId: row.driverId,
              vehicleUnitId: row.vehicleUnitId,
            })
            if (denormTrip.providerIsOwnFleet && denormTrip.vehicleAssetId !== row.assetId) {
              throw new Error(
                `Fila ${i + 2}: En flota propia, el activo del viaje debe coincidir con el assetId de la unidad`,
              )
            }
            const trip: TransportTrip = {
              id: newId.tmsTrip(),
              tenantId: ctx.tenantId,
              assetId: row.assetId,
              orderIds: [order.id],
              routeId: row.routeId,
              providerId: row.providerId,
              providerName: denormTrip.providerName,
              driverId: row.driverId,
              driverName: denormTrip.driverName,
              vehicleUnitId: row.vehicleUnitId,
              vehicleUnitCode: denormTrip.vehicleUnitCode,
              startDate: row.startDate,
              endDate: row.endDate,
              distanceKm: row.distanceKm,
              status: row.tripStatus ?? 'PLANNED',
              createdAt: now,
              updatedAt: now,
            }
            await repo.putTransportTrip(trip)
            createdOrders.push(order)
            createdTrips.push(trip)
          } catch (e) {
            errors.push({ index: i, message: e instanceof Error ? e.message : String(e) })
          }
        }
        return finalizeAudit(ctx, event, json(200, {
          createdOrders: createdOrders.length,
          createdTrips: createdTrips.length,
          errorCount: errors.length,
          errors,
        }))
      }
    }

    // --- simulations ---
    if (seg[0] === 'v1' && seg[1] === 'simulations' && seg.length === 2) {
      if (method === 'GET') {
        const items = await repo.listSimulations(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = simulationBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
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
        return finalizeAudit(ctx, event, json(201, simulation))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'simulations' && seg[2] && seg.length === 3) {
      const simulationId = seg[2]
      if (method === 'GET') {
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Simulación no encontrada')
        return finalizeAudit(ctx, event, json(200, sim))
      }
      if (method === 'PATCH') {
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Simulación no encontrada')
        const body = patchSimulationBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
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
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Simulación no encontrada')
        await repo.deleteSimulation(ctx.tenantId, simulationId)
        return finalizeAudit(ctx, event, noContent())
      }
    }

    // --- TMS (operacional → RevenueFact / CostFact; sin métricas en TMS) ---
    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'cost-categories' && seg.length === 3) {
      if (method === 'GET') {
        return finalizeAudit(ctx, event, json(200, { items: COST_CATEGORY_CATALOG }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'summary' && seg.length === 3) {
      if (method === 'GET') {
        const s = await buildTmsSummary(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, s))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'customers' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTmsCustomers(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTmsCustomerBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const c: TmsCustomer = {
          id: newId.tmsCustomer(),
          tenantId: ctx.tenantId,
          name: body.data.name,
          taxId: body.data.taxId,
          notes: body.data.notes,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTmsCustomer(c)
        return finalizeAudit(ctx, event, json(201, c))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'customers' && seg[3] && seg.length === 4) {
      const customerId = seg[3]
      if (method === 'GET') {
        const c = await repo.getTmsCustomer(ctx.tenantId, customerId)
        if (!c) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Cliente no encontrado')
        return finalizeAudit(ctx, event, json(200, c))
      }
      if (method === 'PATCH') {
        const existing = await repo.getTmsCustomer(ctx.tenantId, customerId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Cliente no encontrado')
        const body = patchTmsCustomerBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: TmsCustomer = { ...existing, ...body.data, updatedAt: now }
        await repo.putTmsCustomer(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        try {
          await repo.deleteTmsCustomer(ctx.tenantId, customerId)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'TMS_CUSTOMER_IN_USE') {
            return auditedJsonError(ctx, event, 409, 'CONFLICT', 'Cliente referenciado por órdenes')
          }
          throw e
        }
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'localities' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTmsLocalities(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTmsLocalityBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const loc: TmsLocality = {
          id: newId.tmsLocality(),
          tenantId: ctx.tenantId,
          name: body.data.name,
          region: body.data.region,
          country: body.data.country,
          notes: body.data.notes,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTmsLocality(loc)
        return finalizeAudit(ctx, event, json(201, loc))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'localities' && seg[3] && seg.length === 4) {
      const localityId = seg[3]
      if (method === 'GET') {
        const loc = await repo.getTmsLocality(ctx.tenantId, localityId)
        if (!loc) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Localidad no encontrada')
        return finalizeAudit(ctx, event, json(200, loc))
      }
      if (method === 'PATCH') {
        const existing = await repo.getTmsLocality(ctx.tenantId, localityId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Localidad no encontrada')
        const body = patchTmsLocalityBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: TmsLocality = { ...existing, ...body.data, updatedAt: now }
        await repo.putTmsLocality(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        try {
          await repo.deleteTmsLocality(ctx.tenantId, localityId)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'TMS_LOCALITY_IN_USE') {
            return auditedJsonError(ctx, event, 409, 'CONFLICT', 'Localidad referenciada por órdenes')
          }
          throw e
        }
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'providers' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTmsProviders(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTmsProviderBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const p: TmsTransportProvider = {
          id: newId.tmsProvider(),
          tenantId: ctx.tenantId,
          name: body.data.name,
          isOwnFleet: body.data.isOwnFleet ?? false,
          taxId: body.data.taxId,
          notes: body.data.notes,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTmsProvider(p)
        return finalizeAudit(ctx, event, json(201, p))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'providers' && seg[3] && seg.length === 4) {
      const providerId = seg[3]
      if (method === 'GET') {
        const p = await repo.getTmsProvider(ctx.tenantId, providerId)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
        return finalizeAudit(ctx, event, json(200, p))
      }
      if (method === 'PATCH') {
        const existing = await repo.getTmsProvider(ctx.tenantId, providerId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
        const body = patchTmsProviderBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: TmsTransportProvider = { ...existing, ...body.data, updatedAt: now }
        await repo.putTmsProvider(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'drivers' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTmsDrivers(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTmsDriverBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const provider = await repo.getTmsProvider(ctx.tenantId, body.data.providerId)
        if (!provider) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
        const now = new Date().toISOString()
        const d: TmsDriver = {
          id: newId.tmsDriver(),
          tenantId: ctx.tenantId,
          providerId: body.data.providerId,
          name: body.data.name,
          licenseNumber: body.data.licenseNumber,
          phone: body.data.phone,
          notes: body.data.notes,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTmsDriver(d)
        return finalizeAudit(ctx, event, json(201, d))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'vehicle-units' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTmsVehicleUnits(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTmsVehicleUnitBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const provider = await repo.getTmsProvider(ctx.tenantId, body.data.providerId)
        if (!provider) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
        if (provider.isOwnFleet) {
          if (!body.data.assetId) {
            return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Para flota propia, la unidad requiere assetId')
          }
          try {
            await requireTransportAsset(ctx.tenantId, body.data.assetId)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg === 'ASSET_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
            if (msg === 'ASSET_NOT_TRANSPORT') return auditedJsonError(ctx, event, 400, 'VALIDATION', 'El activo debe ser type transport')
            throw e
          }
          const existingUnits = await repo.listTmsVehicleUnits(ctx.tenantId)
          const inUse = existingUnits.some(u => u.assetId && u.assetId === body.data.assetId)
          if (inUse) {
            return auditedJsonError(ctx, event, 409, 'CONFLICT', 'El activo ya est\u00e1 asociado a otra unidad TMS')
          }
        }
        const now = new Date().toISOString()
        const v: TmsVehicleUnit = {
          id: newId.tmsVehicleUnit(),
          tenantId: ctx.tenantId,
          providerId: body.data.providerId,
          assetId: body.data.assetId,
          code: body.data.code,
          plate: body.data.plate,
          capacityPackages: body.data.capacityPackages,
          notes: body.data.notes,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTmsVehicleUnit(v)
        return finalizeAudit(ctx, event, json(201, v))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'rates' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTmsRates(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTmsRateBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const [customer, origin, destination, provider] = await Promise.all([
          repo.getTmsCustomer(ctx.tenantId, body.data.customerId),
          repo.getTmsLocality(ctx.tenantId, body.data.originLocalityId),
          repo.getTmsLocality(ctx.tenantId, body.data.destinationLocalityId),
          repo.getTmsProvider(ctx.tenantId, body.data.providerId),
        ])
        if (!customer || !origin || !destination || !provider) {
          return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Cliente/origen/destino/proveedor no encontrado')
        }
        const now = new Date().toISOString()
        const rate: TmsRate = {
          id: newId.tmsRate(),
          tenantId: ctx.tenantId,
          customerId: body.data.customerId,
          originLocalityId: body.data.originLocalityId,
          destinationLocalityId: body.data.destinationLocalityId,
          providerId: body.data.providerId,
          buyPrice: body.data.buyPrice,
          sellPrice: body.data.sellPrice,
          currency: (body.data.currency ?? 'USD').toUpperCase(),
          validFrom: body.data.validFrom,
          validTo: body.data.validTo,
          isActive: body.data.isActive ?? true,
          notes: body.data.notes,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTmsRate(rate)
        return finalizeAudit(ctx, event, json(201, rate))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'routes' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTmsRoutes(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTmsRouteBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const route: TmsRoute = {
          id: newId.tmsRoute(),
          tenantId: ctx.tenantId,
          name: body.data.name,
          originLocalityId: body.data.originLocalityId,
          destinationLocalityId: body.data.destinationLocalityId,
          stops: body.data.stops.map(s => ({ ...s, id: newId.tmsRouteStop() })),
          notes: body.data.notes,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTmsRoute(route)
        return finalizeAudit(ctx, event, json(201, route))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'orders' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTransportOrders(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTransportOrderBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        let denorm: { customerName: string; originLabel: string; destinationLabel: string; providerName: string }
        try {
          denorm = await resolveTransportOrderDenorm(ctx.tenantId, {
            customerId: body.data.customerId,
            originLocalityId: body.data.originLocalityId,
            destinationLocalityId: body.data.destinationLocalityId,
            providerId: body.data.providerId,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'TMS_CUSTOMER_NOT_FOUND') {
            return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Cliente no encontrado')
          }
          if (msg === 'TMS_LOCALITY_NOT_FOUND') {
            return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Localidad no encontrada')
          }
          if (msg === 'TMS_PROVIDER_NOT_FOUND') {
            return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
          }
          throw e
        }
        let rate: Awaited<ReturnType<typeof resolveTmsRateForOrder>>
        try {
          rate = await resolveTmsRateForOrder(ctx.tenantId, {
            customerId: body.data.customerId,
            originLocalityId: body.data.originLocalityId,
            destinationLocalityId: body.data.destinationLocalityId,
            providerId: body.data.providerId,
            atIso: body.data.scheduledDate,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'TMS_RATE_NOT_FOUND') {
            return auditedJsonError(ctx, event, 400, 'VALIDATION', 'No hay tarifa vigente para cliente/origen/destino/proveedor')
          }
          throw e
        }
        const now = new Date().toISOString()
        const o: TransportOrder = {
          id: newId.tmsOrder(),
          tenantId: ctx.tenantId,
          customerId: body.data.customerId,
          originLocalityId: body.data.originLocalityId,
          destinationLocalityId: body.data.destinationLocalityId,
          customerName: denorm.customerName,
          originLabel: denorm.originLabel,
          destinationLabel: denorm.destinationLabel,
          packageCount: body.data.packageCount,
          providerId: body.data.providerId,
          providerName: denorm.providerName,
          rateId: rate.id,
          sellPrice: rate.sellPrice,
          buyPrice: rate.buyPrice,
          currency: rate.currency,
          marginAmount: rate.sellPrice - rate.buyPrice,
          cargoDescription: body.data.cargoDescription,
          scheduledDate: body.data.scheduledDate,
          status: body.data.status ?? 'CREATED',
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTransportOrder(o)
        return finalizeAudit(ctx, event, json(201, o))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'orders' && seg[3] && seg.length === 4) {
      const orderId = seg[3]
      if (method === 'GET') {
        const ord = await repo.getTransportOrder(ctx.tenantId, orderId)
        if (!ord) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Orden no encontrada')
        return finalizeAudit(ctx, event, json(200, ord))
      }
      if (method === 'PATCH') {
        const existing = await repo.getTransportOrder(ctx.tenantId, orderId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Orden no encontrada')
        const body = patchTransportOrderBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: TransportOrder = { ...existing, ...body.data, updatedAt: now }
        const touchedCat =
          body.data.customerId !== undefined ||
          body.data.originLocalityId !== undefined ||
          body.data.destinationLocalityId !== undefined ||
          body.data.providerId !== undefined ||
          body.data.scheduledDate !== undefined
        if (touchedCat) {
          if (
            !updated.customerId ||
            !updated.originLocalityId ||
            !updated.destinationLocalityId ||
            !updated.providerId
          ) {
            return auditedJsonError(
              ctx,
              event,
              400,
              'VALIDATION',
              'Si actualizas catálogo, indica cliente, origen, destino y proveedor',
            )
          }
          try {
            const denorm = await resolveTransportOrderDenorm(ctx.tenantId, {
              customerId: updated.customerId,
              originLocalityId: updated.originLocalityId,
              destinationLocalityId: updated.destinationLocalityId,
              providerId: updated.providerId,
            })
            updated.customerName = denorm.customerName
            updated.originLabel = denorm.originLabel
            updated.destinationLabel = denorm.destinationLabel
            updated.providerName = denorm.providerName
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg === 'TMS_CUSTOMER_NOT_FOUND') {
              return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Cliente no encontrado')
            }
            if (msg === 'TMS_LOCALITY_NOT_FOUND') {
              return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Localidad no encontrada')
            }
            if (msg === 'TMS_PROVIDER_NOT_FOUND') {
              return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
            }
            throw e
          }
          try {
            const rate = await resolveTmsRateForOrder(ctx.tenantId, {
              customerId: updated.customerId,
              originLocalityId: updated.originLocalityId,
              destinationLocalityId: updated.destinationLocalityId,
              providerId: updated.providerId,
              atIso: updated.scheduledDate,
            })
            updated.rateId = rate.id
            updated.sellPrice = rate.sellPrice
            updated.buyPrice = rate.buyPrice
            updated.currency = rate.currency
            updated.marginAmount = rate.sellPrice - rate.buyPrice
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg === 'TMS_RATE_NOT_FOUND') {
              return auditedJsonError(ctx, event, 400, 'VALIDATION', 'No hay tarifa vigente para cliente/origen/destino/proveedor')
            }
            throw e
          }
        }
        await repo.putTransportOrder(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'trips' && seg.length === 3) {
      if (method === 'GET') {
        const items = await repo.listTransportTrips(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createTransportTripBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        try {
          await requireTransportAsset(ctx.tenantId, body.data.assetId)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'ASSET_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
          if (msg === 'ASSET_NOT_TRANSPORT') return auditedJsonError(ctx, event, 400, 'VALIDATION', 'El activo debe ser type transport')
          throw e
        }
        for (const oid of body.data.orderIds) {
          const ord = await repo.getTransportOrder(ctx.tenantId, oid)
          if (!ord) return auditedJsonError(ctx, event, 400, 'VALIDATION', `Orden no encontrada: ${oid}`)
        }
        let assignDenorm: {
          providerName: string
          providerIsOwnFleet: boolean
          driverName: string
          vehicleUnitCode: string
          vehicleAssetId?: string
        }
        try {
          assignDenorm = await resolveTripAssignmentDenorm(ctx.tenantId, {
            providerId: body.data.providerId,
            driverId: body.data.driverId,
            vehicleUnitId: body.data.vehicleUnitId,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'TMS_PROVIDER_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
          if (msg === 'TMS_DRIVER_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Conductor no encontrado')
          if (msg === 'TMS_VEHICLE_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Unidad no encontrada')
          if (msg === 'TMS_DRIVER_PROVIDER_MISMATCH' || msg === 'TMS_VEHICLE_PROVIDER_MISMATCH') {
            return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Conductor/unidad no pertenecen al proveedor indicado')
          }
          throw e
        }
        if (assignDenorm.providerIsOwnFleet && assignDenorm.vehicleAssetId !== body.data.assetId) {
          return auditedJsonError(
            ctx,
            event,
            400,
            'VALIDATION',
            'En flota propia, el activo del viaje debe coincidir con el assetId de la unidad',
          )
        }
        const now = new Date().toISOString()
        const t: TransportTrip = {
          id: newId.tmsTrip(),
          tenantId: ctx.tenantId,
          assetId: body.data.assetId,
          orderIds: body.data.orderIds,
          routeId: body.data.routeId,
          providerId: body.data.providerId,
          providerName: assignDenorm.providerName,
          driverId: body.data.driverId,
          driverName: assignDenorm.driverName,
          vehicleUnitId: body.data.vehicleUnitId,
          vehicleUnitCode: assignDenorm.vehicleUnitCode,
          startDate: body.data.startDate,
          endDate: body.data.endDate,
          distanceKm: body.data.distanceKm,
          status: body.data.status ?? 'PLANNED',
          createdAt: now,
          updatedAt: now,
        }
        await repo.putTransportTrip(t)
        return finalizeAudit(ctx, event, json(201, t))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'trips' && seg[3] && seg.length === 4) {
      const tripId = seg[3]
      if (method === 'GET') {
        const trip = await repo.getTransportTrip(ctx.tenantId, tripId)
        if (!trip) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Viaje no encontrado')
        return finalizeAudit(ctx, event, json(200, trip))
      }
      if (method === 'PATCH') {
        const existing = await repo.getTransportTrip(ctx.tenantId, tripId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Viaje no encontrado')
        const body = patchTransportTripBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: TransportTrip = { ...existing, ...body.data, updatedAt: now }
        const touchesAssignment =
          body.data.providerId !== undefined || body.data.driverId !== undefined || body.data.vehicleUnitId !== undefined
        const touchesTripAsset = body.data.assetId !== undefined
        if (touchesAssignment) {
          if (!updated.providerId || !updated.driverId || !updated.vehicleUnitId) {
            return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Debes indicar proveedor, conductor y unidad')
          }
          try {
            const denorm = await resolveTripAssignmentDenorm(ctx.tenantId, {
              providerId: updated.providerId,
              driverId: updated.driverId,
              vehicleUnitId: updated.vehicleUnitId,
            })
            updated.providerName = denorm.providerName
            updated.driverName = denorm.driverName
            updated.vehicleUnitCode = denorm.vehicleUnitCode
            if (denorm.providerIsOwnFleet && denorm.vehicleAssetId !== updated.assetId) {
              return auditedJsonError(
                ctx,
                event,
                400,
                'VALIDATION',
                'En flota propia, el activo del viaje debe coincidir con el assetId de la unidad',
              )
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg === 'TMS_PROVIDER_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
            if (msg === 'TMS_DRIVER_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Conductor no encontrado')
            if (msg === 'TMS_VEHICLE_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Unidad no encontrada')
            if (msg === 'TMS_DRIVER_PROVIDER_MISMATCH' || msg === 'TMS_VEHICLE_PROVIDER_MISMATCH') {
              return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Conductor/unidad no pertenecen al proveedor indicado')
            }
            throw e
          }
        }
        if (touchesTripAsset && !touchesAssignment) {
          try {
            const denorm = await resolveTripAssignmentDenorm(ctx.tenantId, {
              providerId: updated.providerId,
              driverId: updated.driverId,
              vehicleUnitId: updated.vehicleUnitId,
            })
            if (denorm.providerIsOwnFleet && denorm.vehicleAssetId !== updated.assetId) {
              return auditedJsonError(
                ctx,
                event,
                400,
                'VALIDATION',
                'En flota propia, el activo del viaje debe coincidir con el assetId de la unidad',
              )
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg === 'TMS_PROVIDER_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proveedor no encontrado')
            if (msg === 'TMS_DRIVER_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Conductor no encontrado')
            if (msg === 'TMS_VEHICLE_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Unidad no encontrada')
            if (msg === 'TMS_DRIVER_PROVIDER_MISMATCH' || msg === 'TMS_VEHICLE_PROVIDER_MISMATCH') {
              return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Conductor/unidad no pertenecen al proveedor indicado')
            }
            throw e
          }
        }
        await repo.putTransportTrip(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'trips' && seg[3] && seg[4] === 'costs' && seg.length === 5) {
      const tripId = seg[3]
      if (method === 'POST') {
        const trip = await repo.getTransportTrip(ctx.tenantId, tripId)
        if (!trip) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Viaje no encontrado')
        const body = tmsTripCostBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        if (body.data.assetId !== trip.assetId) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'assetId debe coincidir con el viaje')
        }
        if (!isKnownCostCategory(body.data.category)) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', `Categoría de costo desconocida: ${body.data.category}`)
        }
        try {
          await requireTransportAsset(ctx.tenantId, body.data.assetId)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'ASSET_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
          if (msg === 'ASSET_NOT_TRANSPORT') return auditedJsonError(ctx, event, 400, 'VALIDATION', 'El activo debe ser type transport')
          throw e
        }
        const now = new Date().toISOString()
        const cf: CostFact = {
          id: newId.fact(),
          tenantId: ctx.tenantId,
          assetId: body.data.assetId,
          date: body.data.date,
          amount: body.data.amount,
          category: body.data.category,
          source: 'api',
          createdAt: now,
          sourceRef: { kind: 'tms_trip', id: tripId },
        }
        await repo.putCostFact(cf)
        return finalizeAudit(ctx, event, json(201, cf))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'tms' && seg[2] === 'trips' && seg[3] && seg[4] === 'revenue' && seg.length === 5) {
      const tripId = seg[3]
      if (method === 'POST') {
        const trip = await repo.getTransportTrip(ctx.tenantId, tripId)
        if (!trip) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Viaje no encontrado')
        const body = tmsTripRevenueBody.safeParse(parseBody(event.body))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        if (body.data.assetId !== trip.assetId) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'assetId debe coincidir con el viaje')
        }
        try {
          await requireTransportAsset(ctx.tenantId, body.data.assetId)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'ASSET_NOT_FOUND') return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
          if (msg === 'ASSET_NOT_TRANSPORT') return auditedJsonError(ctx, event, 400, 'VALIDATION', 'El activo debe ser type transport')
          throw e
        }
        const now = new Date().toISOString()
        const rf: RevenueFact = {
          id: newId.fact(),
          tenantId: ctx.tenantId,
          assetId: body.data.assetId,
          date: body.data.date,
          amount: body.data.amount,
          category: 'tms_revenue',
          source: 'api',
          createdAt: now,
          sourceRef: { kind: 'tms_trip', id: tripId },
        }
        await repo.putRevenueFact(rf)
        return finalizeAudit(ctx, event, json(201, rf))
      }
    }

    // --- alerts ---
    if (seg[0] === 'v1' && seg[1] === 'alerts' && seg.length === 2) {
      if (method === 'GET') {
        return finalizeAudit(ctx, event, json(200, { items: [] }))
      }
    }

    return auditedJsonError(ctx, event, 404, 'NOT_FOUND', `Ruta no implementada: ${method} ${path}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(e)
    return auditedJsonError(ctx, event, 500, 'INTERNAL', msg)
  }
}
