import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { randomUUID } from 'crypto'
import { resolvePlatformAdmin, resolveRequestContext } from '../auth/context'
import { loadRbacState, normalizeRbacAssignmentsInput } from '../auth/rbac-state'
import { requireRbac } from '../auth/require-rbac'
import * as accessRepo from '../repositories/access-repository'
import * as repo from '../repositories/core-repository'
import {
  createAdminTenantUserBody,
  createAccessRoleBody,
  createAssetBody,
  createInvestorBody,
  createPortfolioBody,
  createProjectBody,
  createScenarioBody,
  createBillingIntentBody,
  capitalContributionBody,
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
  occupancyRecordBody,
  patchAccessRoleBody,
  patchAccessUserBody,
  patchAdminAccessUserBody,
  putSelfUserProfileBody,
  patchAssetBody,
  patchInvestorBody,
  patchPortfolioBody,
  patchProjectBody,
  patchScenarioBody,
  patchBillingIntentBody,
  patchTenantBody,
  patchSimulationBody,
  patchTmsCustomerBody,
  patchTmsLocalityBody,
  patchTmsProviderBody,
  patchTransportOrderBody,
  patchTransportTripBody,
  putAssetCashFlowsBody,
  putAssetFinancingBody,
  putProjectInvestorAllocationsBody,
  realEstateCostFactBody,
  realEstateRevenueFactBody,
  simulationBody,
  tmsTripCostBody,
  tmsTripRevenueBody,
} from '../domain/schemas'
import { COST_CATEGORY_CATALOG } from '../domain/cost-categories'
import { PERMISSION_KEYS } from '../domain/permission-keys'
import { effectivePermissionsPreview } from '../domain/rbac'
import { auditedJsonError, finalizeAudit, finalizePlatformAudit } from '../lib/audit'
import { json, noContent } from '../lib/http'
import { newId } from '../lib/ids'
import { publishDomainEvent } from '../lib/events'
import { ensureCognitoUser, setCognitoUserPassword } from '../lib/cognito-admin'
import { computeAssetFinancialPackageForAsset, computeAssetMetricsForAsset } from '../services/metrics'
import { aggregateFinancialPackages } from '../services/aggregate-metrics'
import {
  buildFinancialInsightInput,
  generateFinancialInsights,
} from '../services/financial-insights-engine'
import * as insightRulesRepo from '../repositories/insight-rules-repository'
import { computeSimulationProjection, SIMULATION_CALCULATION_VERSION } from '../services/simulation-projection'
import { buildStandardizedStructure } from '../services/structure'
import { buildInsights } from '../services/insights'
import {
  ensureDefaultActualScenarioForProject,
  loadProjectAssetsForScenarioMetrics,
  loadTenantAssetsForExecutiveDashboard,
  resolveScenarioIdForAssetWrite,
} from '../services/scenario-load'
import {
  buildInvestorCapitalAccount,
  buildPortfolioCapitalParticipation,
  buildProjectCapitalParticipation,
  validateAndReplaceProjectAllocations,
} from '../services/participation'
import { buildInvestorExposure } from '../services/investors'
import { buildAssetRegisterReport, buildInvestmentSummaryReport, buildPortfolioSnapshotReport } from '../services/reports'
import { tryRouteDocuments } from './documents-routes'
import { tryRouteFlipping } from './flipping-routes'
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
  CapitalContribution,
  CostFact,
  ImportJob,
  Investor,
  InvestorLedgerEntry,
  OccupancyRecord,
  Portfolio,
  Project,
  Scenario,
  RevenueFact,
  Simulation,
  BillingIntent,
  Tenant,
  TenantBilling,
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

function parseBody<T>(event: Pick<APIGatewayProxyEventV2, 'body' | 'isBase64Encoded'>): T {
  const raw = event.body
  if (!raw) return {} as T
  const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw
  return JSON.parse(text) as T
}

function segments(path: string): string[] {
  return path.replace(/\/+$/, '').split('/').filter(Boolean)
}

function validatePermissionKeys(keys: string[]): string | null {
  const allowed = new Set<string>([...PERMISSION_KEYS])
  for (const k of keys) {
    if (!allowed.has(k)) return `Permiso no reconocido: ${k}`
  }
  return null
}

function normalizeTenantBillingInput(input: {
  status: TenantBilling['status']
  plan: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
}): TenantBilling {
  const out: TenantBilling = {
    status: input.status,
    plan: input.plan.trim() as TenantBilling['plan'],
    updatedAt: new Date().toISOString(),
  }
  if (input.stripeCustomerId) out.stripeCustomerId = input.stripeCustomerId.trim()
  if (input.stripeSubscriptionId) out.stripeSubscriptionId = input.stripeSubscriptionId.trim()
  return out
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

function requireRealEstateAssetType(
  event: APIGatewayProxyEventV2,
  ctx: { tenantId: string; subject?: string },
  asset: Asset,
): APIGatewayProxyResultV2 | null {
  if (asset.type === 'real_estate') return null
  return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Esta operación solo aplica a activos de tipo real_estate')
}

async function loadAssetFinancialPackage(tenantId: string, asset: Asset) {
  const [rev, cost, fin, contributions] = await Promise.all([
    repo.listRevenueFacts(tenantId, asset.id),
    repo.listCostFacts(tenantId, asset.id),
    repo.getFinancing(tenantId, asset.id),
    repo.listCapitalContributions(tenantId, asset.id),
  ])
  return computeAssetFinancialPackageForAsset(tenantId, asset, rev, cost, fin, contributions)
}

async function routeAdmin(
  event: APIGatewayProxyEventV2,
  method: string,
  seg: string[],
  adminCtx: { tenantId: string; subject: string },
): Promise<APIGatewayProxyResultV2> {
  if (seg[2] === 'onboarding-requests' && seg.length === 3 && method === 'GET') {
    const items = await repo.listBillingIntents()
    return finalizePlatformAudit(event, adminCtx.subject, json(200, { items }))
  }
  if (seg[2] === 'onboarding-requests' && seg[3] && seg.length === 4 && method === 'PATCH') {
    const existing = await repo.getBillingIntent(seg[3])
    if (!existing) return auditedJsonError(adminCtx, event, 404, 'NOT_FOUND', 'Solicitud no encontrada')
    const body = patchBillingIntentBody.safeParse(parseBody(event))
    if (!body.success)
      return auditedJsonError(adminCtx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
    const now = new Date().toISOString()
    const next: BillingIntent = {
      ...existing,
      ...(body.data.status ? { status: body.data.status } : {}),
      ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
      ...(body.data.status ? { processedAt: now, processedBy: adminCtx.subject } : {}),
      updatedAt: now,
    }
    await repo.putBillingIntent(next)
    return finalizePlatformAudit(event, adminCtx.subject, json(200, next))
  }

  if (seg[2] === 'tenants' && seg.length === 3) {
    if (method === 'GET') {
      const items = await repo.listTenants()
      return finalizePlatformAudit(event, adminCtx.subject, json(200, { items }))
    }
    if (method === 'POST') {
      const body = createTenantBody.safeParse(parseBody(event))
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
      if (body.data.billing) t.billing = normalizeTenantBillingInput(body.data.billing)
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
      const body = patchTenantBody.safeParse(parseBody(event))
      if (!body.success)
        return auditedJsonError(adminCtx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
      const { billing: billingPatch, ...tenantPatch } = body.data
      const t: Tenant = {
        ...existing,
        ...tenantPatch,
      }
      if (billingPatch !== undefined) {
        t.billing = billingPatch ? normalizeTenantBillingInput(billingPatch) : undefined
      }
      await repo.putTenant(t)
      return finalizePlatformAudit(event, adminCtx.subject, json(200, t))
    }
  }

  // /v1/admin/tenants/{tenantId}/access/users — gestión de perfiles/RBAC por tenant (admin plataforma).
  if (seg[2] === 'tenants' && seg[3] && seg[4] === 'access' && seg[5] === 'users') {
    const tenantId = seg[3]
    const tenantErr = await ensureTenant(adminCtx, event, tenantId)
    if (tenantErr) return tenantErr

    if (seg.length === 6 && method === 'GET') {
      const items = await accessRepo.listTenantUserProfiles(tenantId)
      return finalizePlatformAudit(event, adminCtx.subject, json(200, { items }))
    }

    if (seg.length === 6 && method === 'POST') {
      const body = createAdminTenantUserBody.safeParse(parseBody(event))
      if (!body.success)
        return auditedJsonError(adminCtx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())

      const cognito = await ensureCognitoUser({
        email: body.data.email,
        tenantId,
        displayName: body.data.displayName,
        initialPassword: body.data.initialPassword,
      })
      const targetSub = cognito.sub
      const existing = await accessRepo.getTenantUserProfile(tenantId, targetSub)
      const now = new Date().toISOString()
      const rbacAssignments =
        body.data.rbacAssignments !== undefined
          ? normalizeRbacAssignmentsInput(tenantId, targetSub, body.data.rbacAssignments)
          : existing?.rbacAssignments ?? []

      if (!existing) {
        const created: TenantUserProfile = {
          tenantId,
          cognitoSub: targetSub,
          email: cognito.email,
          displayName: body.data.displayName,
          photoUrl: body.data.photoUrl,
          preferences: body.data.preferences,
          roleIds: body.data.roleIds ?? [],
          rbacAssignments,
          createdAt: now,
          updatedAt: now,
        }
        await accessRepo.putTenantUserProfile(created)
        return finalizePlatformAudit(event, adminCtx.subject, json(201, created))
      }

      const updated: TenantUserProfile = {
        ...existing,
        email: cognito.email,
        displayName: body.data.displayName ?? existing.displayName,
        photoUrl: body.data.photoUrl ?? existing.photoUrl,
        preferences: body.data.preferences ?? existing.preferences,
        roleIds: body.data.roleIds ?? existing.roleIds,
        rbacAssignments,
        updatedAt: now,
      }
      await accessRepo.putTenantUserProfile(updated)
      return finalizePlatformAudit(event, adminCtx.subject, json(200, updated))
    }

    if (seg.length === 7 && seg[6]) {
      const targetSub = seg[6]
      if (method === 'PATCH') {
        const body = patchAdminAccessUserBody.safeParse(parseBody(event))
        if (!body.success)
          return auditedJsonError(adminCtx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const existing = await accessRepo.getTenantUserProfile(tenantId, targetSub)
        if (!existing) return auditedJsonError(adminCtx, event, 404, 'NOT_FOUND', 'Usuario no encontrado en este tenant')
        const { cognitoNewPassword, cognitoPasswordPermanent, ...profilePatch } = body.data
        if (cognitoNewPassword) {
          const emailForCognito = profilePatch.email ?? existing.email
          await setCognitoUserPassword({
            email: emailForCognito,
            cognitoSub: targetSub,
            password: cognitoNewPassword,
            permanent: cognitoPasswordPermanent ?? true,
          })
        }
        const now = new Date().toISOString()
        const rbacAssignments =
          body.data.rbacAssignments !== undefined
            ? normalizeRbacAssignmentsInput(tenantId, targetSub, body.data.rbacAssignments)
            : existing.rbacAssignments
        const updated: TenantUserProfile = {
          ...existing,
          ...profilePatch,
          rbacAssignments,
          updatedAt: now,
        }
        await accessRepo.putTenantUserProfile(updated)
        return finalizePlatformAudit(event, adminCtx.subject, json(200, updated))
      }
      if (method === 'PUT') {
        const body = patchAccessUserBody.safeParse(parseBody(event))
        if (!body.success)
          return auditedJsonError(adminCtx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const existing = await accessRepo.getTenantUserProfile(tenantId, targetSub)
        const now = new Date().toISOString()
        if (!existing) {
          if (!body.data.email)
            return auditedJsonError(
              adminCtx,
              event,
              400,
              'VALIDATION',
              'Para crear un perfil en este tenant se requiere email en el cuerpo',
            )
          const rbacAssignments =
            body.data.rbacAssignments !== undefined
              ? normalizeRbacAssignmentsInput(tenantId, targetSub, body.data.rbacAssignments)
              : []
          const created: TenantUserProfile = {
            tenantId,
            cognitoSub: targetSub,
            email: body.data.email,
            displayName: body.data.displayName,
            photoUrl: body.data.photoUrl,
            preferences: body.data.preferences,
            roleIds: body.data.roleIds ?? [],
            rbacAssignments,
            createdAt: now,
            updatedAt: now,
          }
          await accessRepo.putTenantUserProfile(created)
          return finalizePlatformAudit(event, adminCtx.subject, json(201, created))
        }
        const rbacAssignments =
          body.data.rbacAssignments !== undefined
            ? normalizeRbacAssignmentsInput(tenantId, targetSub, body.data.rbacAssignments)
            : existing.rbacAssignments
        const updated: TenantUserProfile = {
          ...existing,
          ...body.data,
          rbacAssignments,
          updatedAt: now,
        }
        await accessRepo.putTenantUserProfile(updated)
        return finalizePlatformAudit(event, adminCtx.subject, json(200, updated))
      }
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

  if (seg[0] === 'v1' && seg[1] === 'public' && seg[2] === 'onboarding-requests' && seg.length === 3 && method === 'POST') {
    const ip =
      event.headers?.['x-forwarded-for']?.split(',')?.[0]?.trim() ??
      (event.requestContext?.http as { sourceIp?: string } | undefined)?.sourceIp ??
      'unknown'
    const body = createBillingIntentBody.safeParse(parseBody(event))
    if (!body.success) return auditedJsonError(undefined, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
    const email = body.data.email.trim().toLowerCase()

    // Anti-spam MVP: 1 request por email cada 10 min + 1 request por IP cada 30s.
    const okEmail = await repo.tryAcquireOnboardingRateLimit('email', email, 10 * 60)
    const okIp = await repo.tryAcquireOnboardingRateLimit('ip', ip, 30)
    if (!okEmail || !okIp) {
      return auditedJsonError(undefined, event, 429, 'RATE_LIMIT', 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.')
    }

    // Dedupe/idempotencia: si existe una solicitud reciente para el email, reusar.
    const latest = await repo.getLatestBillingIntentByEmail(email)
    if (latest) {
      const lastMs = Date.now() - new Date(latest.createdAt).getTime()
      const within24h = lastMs >= 0 && lastMs < 24 * 60 * 60 * 1000
      const sameIntent = latest.planCode === body.data.planCode && latest.billingCycle === body.data.billingCycle
      const stillOpen = latest.status === 'new' || latest.status === 'contacted' || latest.status === 'approved'
      if (within24h && sameIntent && stillOpen) {
        return json(200, { id: latest.id, status: latest.status, deduped: true })
      }
    }
    const now = new Date().toISOString()
    const item: BillingIntent = {
      id: randomUUID(),
      email,
      name: body.data.name?.trim(),
      planCode: body.data.planCode,
      billingCycle: body.data.billingCycle,
      status: 'new',
      source: body.data.source?.trim() ?? 'website',
      createdAt: now,
      updatedAt: now,
    }
    await repo.putBillingIntent(item)
    return json(201, { id: item.id, status: item.status })
  }

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
    const rbacState = await loadRbacState(ctx)

    // --- /v1/scenarios ---
    if (seg[0] === 'v1' && seg[1] === 'scenarios') {
      if (seg.length === 2 && method === 'GET') {
        const projectId = event.queryStringParameters?.projectId?.trim()
        if (!projectId) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Query projectId es obligatoria')
        }
        const pj = await repo.getProject(ctx.tenantId, projectId)
        if (!pj) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        const denied = requireRbac(ctx, event, rbacState, 'asset:read', {
          portfolioId: pj.portfolioId,
          projectId,
        })
        if (denied) return denied
        const items = await repo.listScenariosByProject(ctx.tenantId, projectId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (seg.length === 2 && method === 'POST') {
        const body = createScenarioBody.safeParse(parseBody(event))
        if (!body.success)
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const pj = await repo.getProject(ctx.tenantId, body.data.projectId)
        if (!pj) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'projectId no existe')
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: pj.portfolioId,
          projectId: body.data.projectId,
        })
        if (deniedW) return deniedW
        await ensureDefaultActualScenarioForProject({
          tenantId: ctx.tenantId,
          portfolioId: pj.portfolioId,
          projectId: pj.id,
          createdBy: ctx.subject,
        })
        const now = new Date().toISOString()
        const s: Scenario = {
          id: newId.scenario(),
          tenantId: ctx.tenantId,
          portfolioId: pj.portfolioId,
          projectId: pj.id,
          name: body.data.name,
          type: 'simulated',
          createdAt: now,
          updatedAt: now,
          createdBy: ctx.subject ?? 'system',
        }
        await repo.putScenario(s)
        return finalizeAudit(ctx, event, json(201, s))
      }

      if (seg.length === 3 && seg[2]) {
        const scenarioId = seg[2]
        const existing = await repo.getScenario(ctx.tenantId, scenarioId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Escenario no encontrado')
        const pj = await repo.getProject(ctx.tenantId, existing.projectId)
        if (!pj) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')

        if (method === 'GET') {
          const denied = requireRbac(ctx, event, rbacState, 'asset:read', {
            portfolioId: pj.portfolioId,
            projectId: existing.projectId,
          })
          if (denied) return denied
          return finalizeAudit(ctx, event, json(200, existing))
        }
        if (method === 'PATCH') {
          const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
            portfolioId: pj.portfolioId,
            projectId: existing.projectId,
          })
          if (deniedW) return deniedW
          const body = patchScenarioBody.safeParse(parseBody(event))
          if (!body.success)
            return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
          const now = new Date().toISOString()
          const updated: Scenario = { ...existing, ...body.data, updatedAt: now }
          await repo.putScenario(updated)
          return finalizeAudit(ctx, event, json(200, updated))
        }
        if (method === 'DELETE') {
          const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
            portfolioId: pj.portfolioId,
            projectId: existing.projectId,
          })
          if (deniedW) return deniedW
          if (existing.type === 'actual') {
            return auditedJsonError(ctx, event, 409, 'CONFLICT', 'No se puede eliminar el escenario actual canónico')
          }
          const assetsInProj = await repo.listAssetsByTenant(ctx.tenantId, { projectId: existing.projectId })
          if (assetsInProj.some(a => a.scenarioId === existing.id)) {
            return auditedJsonError(ctx, event, 409, 'CONFLICT', 'Hay activos asociados a este escenario')
          }
          await repo.deleteScenarioItem(ctx.tenantId, scenarioId)
          return finalizeAudit(ctx, event, noContent())
        }
      }

      if (seg.length === 4 && seg[2] && seg[3] === 'assets') {
        const scenarioId = seg[2]
        const scen = await repo.getScenario(ctx.tenantId, scenarioId)
        if (!scen) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Escenario no encontrado')
        const pj = await repo.getProject(ctx.tenantId, scen.projectId)
        if (!pj) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        if (scen.type !== 'simulated') {
          return auditedJsonError(
            ctx,
            event,
            400,
            'VALIDATION',
            'Solo los escenarios simulados admiten alta de activos por esta ruta',
          )
        }

        if (method === 'GET') {
          const denied = requireRbac(ctx, event, rbacState, 'asset:read', {
            portfolioId: pj.portfolioId,
            projectId: scen.projectId,
          })
          if (denied) return denied
          const assets = await repo.listAssetsByTenant(ctx.tenantId, { projectId: scen.projectId })
          const items = assets.filter(a => a.scenarioId === scen.id)
          return finalizeAudit(ctx, event, json(200, { items }))
        }

        if (method === 'POST') {
          const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
            portfolioId: pj.portfolioId,
            projectId: scen.projectId,
          })
          if (deniedW) return deniedW
          const body = createAssetBody.safeParse(parseBody(event))
          if (!body.success)
            return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
          const b = body.data
          if (b.projectId !== scen.projectId || b.portfolioId !== scen.portfolioId) {
            return auditedJsonError(
              ctx,
              event,
              400,
              'VALIDATION',
              'portfolioId/projectId deben coincidir con el escenario',
            )
          }
          const pf = await repo.getPortfolio(ctx.tenantId, b.portfolioId)
          if (!pf) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'portfolioId no existe')
          const pjr = await repo.getProject(ctx.tenantId, b.projectId)
          if (!pjr || pjr.portfolioId !== b.portfolioId) {
            return auditedJsonError(ctx, event, 400, 'VALIDATION', 'projectId no existe o no pertenece al portfolio')
          }
          const now = new Date().toISOString()
          const asset: Asset = {
            id: newId.asset(),
            tenantId: ctx.tenantId,
            portfolioId: b.portfolioId,
            projectId: b.projectId,
            scenarioId: scen.id,
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
    }

    if (seg[0] === 'v1' && seg[1] === 'revenue-facts' && seg.length === 2) {
      if (method === 'POST') {
        const body = realEstateRevenueFactBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const a = await repo.getAsset(ctx.tenantId, body.data.assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        const typeErr = requireRealEstateAssetType(event, ctx, a)
        if (typeErr) return typeErr
        const now = new Date().toISOString()
        const rf: RevenueFact = {
          id: newId.fact(),
          tenantId: ctx.tenantId,
          assetId: body.data.assetId,
          amount: body.data.amount,
          date: body.data.date,
          category: body.data.category,
          source: 'real_estate',
          createdAt: now,
        }
        await repo.putRevenueFact(rf)
        return finalizeAudit(ctx, event, json(201, rf))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'cost-facts' && seg.length === 2) {
      if (method === 'POST') {
        const body = realEstateCostFactBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const a = await repo.getAsset(ctx.tenantId, body.data.assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        const typeErr = requireRealEstateAssetType(event, ctx, a)
        if (typeErr) return typeErr
        const now = new Date().toISOString()
        const cf: CostFact = {
          id: newId.fact(),
          tenantId: ctx.tenantId,
          assetId: body.data.assetId,
          amount: body.data.amount,
          date: body.data.date,
          category: body.data.category,
          source: 'real_estate',
          createdAt: now,
        }
        await repo.putCostFact(cf)
        return finalizeAudit(ctx, event, json(201, cf))
      }
    }

    // --- /v1/assets ---
    if (seg[0] === 'v1' && seg[1] === 'assets' && seg.length === 2) {
      if (method === 'GET') {
        const q = listQuery.safeParse(event.queryStringParameters ?? {})
        if (!q.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Query inválida', q.error.flatten())
        const denied = requireRbac(ctx, event, rbacState, 'asset:read', {
          portfolioId: q.data.portfolioId,
          projectId: q.data.projectId,
        })
        if (denied) return denied
        let assets = await repo.listAssetsByTenant(ctx.tenantId, {
          projectId: q.data.projectId,
          portfolioId: q.data.portfolioId,
          type: q.data.type,
        })
        const scMode = q.data.scenario
        if (scMode && scMode !== 'actual') {
          if (!q.data.projectId) {
            return auditedJsonError(
              ctx,
              event,
              400,
              'VALIDATION',
              'Para scenario simulated o combined se requiere query projectId',
            )
          }
          const loaded = await loadProjectAssetsForScenarioMetrics(ctx.tenantId, q.data.projectId, {
            scenario: scMode,
            scenarioId: q.data.scenarioId,
          })
          if (!loaded.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', loaded.message)
          assets = loaded.assets
        } else if (scMode === 'actual' || !scMode) {
          if (q.data.projectId) {
            const loaded = await loadProjectAssetsForScenarioMetrics(ctx.tenantId, q.data.projectId, {
              scenario: 'actual',
            })
            if (!loaded.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', loaded.message)
            assets = loaded.assets
          } else if (scMode === 'actual') {
            const loaded = await loadTenantAssetsForExecutiveDashboard(ctx.tenantId, { scenario: 'actual' })
            if (!loaded.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', loaded.message)
            assets = loaded.assets
          }
        }
        return finalizeAudit(ctx, event, json(200, { items: assets, nextCursor: null }))
      }
      if (method === 'POST') {
        const body = createAssetBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const b = body.data
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: b.portfolioId,
          projectId: b.projectId,
        })
        if (deniedW) return deniedW
        const pf = await repo.getPortfolio(ctx.tenantId, b.portfolioId)
        if (!pf) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'portfolioId no existe')
        const pj = await repo.getProject(ctx.tenantId, b.projectId)
        if (!pj || pj.portfolioId !== b.portfolioId) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'projectId no existe o no pertenece al portfolio')
        }
        await ensureDefaultActualScenarioForProject({
          tenantId: ctx.tenantId,
          portfolioId: pj.portfolioId,
          projectId: pj.id,
          createdBy: ctx.subject,
        })
        const resSc = await resolveScenarioIdForAssetWrite(ctx.tenantId, b.portfolioId, b.projectId, b.scenarioId)
        if (!resSc.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', resSc.message)
        const now = new Date().toISOString()
        const asset: Asset = {
          id: newId.asset(),
          tenantId: ctx.tenantId,
          portfolioId: b.portfolioId,
          projectId: b.projectId,
          ...(resSc.scenarioId != null ? { scenarioId: resSc.scenarioId } : {}),
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

    // Debe ir antes de /v1/assets/{assetId} para evitar que "metrics" se trate como assetId.
    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[2] === 'metrics' && seg.length === 3) {
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const type = event.queryStringParameters?.type as Asset['type'] | undefined
        if (!type) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Query `type` es obligatoria')
        const assets = await repo.listAssetsByTenant(ctx.tenantId, { type })
        const packages = []
        for (const asset of assets) {
          packages.push(await loadAssetFinancialPackage(ctx.tenantId, asset))
        }
        return finalizeAudit(ctx, event, json(200, aggregateFinancialPackages('asset_type', type, packages)))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[2] && seg.length === 3 && seg[2] !== 'metrics') {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const denied = requireRbac(ctx, event, rbacState, 'asset:read', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (denied) return denied
        return finalizeAudit(ctx, event, json(200, a))
      }
      if (method === 'PATCH') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        const body = patchAssetBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const { scenarioId: incomingScenario, ...restPatch } = body.data
        const patch: Partial<Asset> = { ...restPatch }
        if (incomingScenario !== undefined) {
          const resSc = await resolveScenarioIdForAssetWrite(
            ctx.tenantId,
            a.portfolioId,
            a.projectId,
            incomingScenario,
          )
          if (!resSc.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', resSc.message)
          patch.scenarioId = resSc.scenarioId
        }
        const touchesStructuralFields =
          patch.type !== undefined ||
          patch.acquisitionDate !== undefined ||
          patch.initialInvestment !== undefined ||
          patch.currency !== undefined
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
          ...patch,
          updatedAt: now,
        }
        await repo.putAsset(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        await repo.deleteFactsForAsset(ctx.tenantId, assetId)
        await repo.deleteFinancingForAsset(ctx.tenantId, assetId)
        await repo.deleteAssetItem(ctx.tenantId, assetId)
        await publishDomainEvent(BUS, 'apip.service', {
          tenantId: ctx.tenantId,
          type: 'AssetDeleted',
          payload: { assetId },
        })
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'financing' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedF = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedF) return deniedF
        const f = await repo.getFinancing(ctx.tenantId, assetId)
        if (!f) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Sin financiamiento registrado')
        return finalizeAudit(ctx, event, json(200, f))
      }
      if (method === 'PUT') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        const body = putAssetFinancingBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const existing = await repo.getFinancing(ctx.tenantId, assetId)
        const id = existing?.id ?? randomUUID()
        const row = {
          id,
          tenantId: ctx.tenantId,
          assetId,
          principal: body.data.principal,
          annualInterestRate: body.data.annualInterestRate,
          termMonths: body.data.termMonths,
          startDate: new Date(body.data.startDate).toISOString(),
          amortizationType: 'french' as const,
          downPayment: body.data.downPayment,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        await repo.putFinancing(row)
        return finalizeAudit(ctx, event, json(200, row))
      }
      if (method === 'DELETE') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        await repo.deleteFinancingForAsset(ctx.tenantId, assetId)
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'metrics' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedF = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedF) return deniedF
        const pkg = await loadAssetFinancialPackage(ctx.tenantId, a)
        const rules = await insightRulesRepo.listInsightRulesForTenant(ctx.tenantId)
        const insightInput = buildFinancialInsightInput(a, pkg)
        const insightsAsset = generateFinancialInsights(rules, insightInput, 'asset')
        const insightsEquity = pkg.metrics.equity
          ? generateFinancialInsights(rules, insightInput, 'equity')
          : null
        return finalizeAudit(
          ctx,
          event,
          json(200, {
            ...pkg,
            insights: { asset: insightsAsset, equity: insightsEquity },
          }),
        )
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'cashflow' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedF = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedF) return deniedF
        const pkg = await loadAssetFinancialPackage(ctx.tenantId, a)
        return finalizeAudit(ctx, event, json(200, { assetId, cashFlow: pkg.metrics.asset.cashFlow }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'facts' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedF = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedF) return deniedF
        const revenueFacts = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const costFacts = await repo.listCostFacts(ctx.tenantId, assetId)
        return finalizeAudit(ctx, event, json(200, { assetId, revenueFacts, costFacts }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'capital-contributions' && seg.length === 4) {
      const assetId = seg[2]
      const a = await repo.getAsset(ctx.tenantId, assetId)
      if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
      const typeErr = requireRealEstateAssetType(event, ctx, a)
      if (typeErr) return typeErr
      if (method === 'GET') {
        const deniedF = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedF) return deniedF
        const items = await repo.listCapitalContributions(ctx.tenantId, assetId)
        items.sort((x, y) => x.date.localeCompare(y.date))
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        const body = capitalContributionBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        if (body.data.investorId) {
          const inv = await repo.getInvestor(ctx.tenantId, body.data.investorId)
          if (!inv) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'investorId no existe')
        }
        const now = new Date().toISOString()
        const item: CapitalContribution = {
          id: newId.capital(),
          tenantId: ctx.tenantId,
          assetId,
          amount: body.data.amount,
          date: body.data.date,
          reason: body.data.reason,
          investorId: body.data.investorId,
          createdAt: now,
        }
        await repo.putCapitalContribution(item)
        return finalizeAudit(ctx, event, json(201, item))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'occupancy' && seg.length === 4) {
      const assetId = seg[2]
      const a = await repo.getAsset(ctx.tenantId, assetId)
      if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
      const typeErr = requireRealEstateAssetType(event, ctx, a)
      if (typeErr) return typeErr
      if (method === 'GET') {
        const deniedF = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedF) return deniedF
        const items = await repo.listOccupancyRecords(ctx.tenantId, assetId)
        items.sort((x, y) => x.month.localeCompare(y.month))
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        const body = occupancyRecordBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        if (body.data.occupiedDays > body.data.availableDays) {
          return auditedJsonError(ctx, event, 400, 'VALIDATION', 'occupiedDays no puede ser mayor a availableDays')
        }
        const now = new Date().toISOString()
        const item: OccupancyRecord = {
          id: newId.fact(),
          tenantId: ctx.tenantId,
          assetId,
          month: body.data.month,
          occupiedDays: body.data.occupiedDays,
          availableDays: body.data.availableDays,
          createdAt: now,
          updatedAt: now,
        }
        await repo.putOccupancyRecord(item)
        return finalizeAudit(ctx, event, json(201, item))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'cash-flows' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'PUT') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedW = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedW) return deniedW
        const body = putAssetCashFlowsBody.safeParse(parseBody(event))
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
        const pkg = await loadAssetFinancialPackage(ctx.tenantId, a)
        return finalizeAudit(ctx, event, json(200, { ...pkg, updatedPeriods: body.data.periods.length }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'assets' && seg[3] === 'structure' && seg.length === 4) {
      const assetId = seg[2]
      if (method === 'GET') {
        const a = await repo.getAsset(ctx.tenantId, assetId)
        if (!a) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Activo no encontrado')
        const deniedF = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: a.portfolioId,
          projectId: a.projectId,
        })
        if (deniedF) return deniedF
        const rev = await repo.listRevenueFacts(ctx.tenantId, assetId)
        const cost = await repo.listCostFacts(ctx.tenantId, assetId)
        const metrics = await computeAssetMetricsForAsset(ctx.tenantId, a, rev, cost)
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
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const body = createAccessRoleBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const role = await accessRepo.getAccessRole(ctx.tenantId, roleId)
        if (!role) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Rol no encontrado')
        return finalizeAudit(ctx, event, json(200, role))
      }
      if (method === 'PATCH') {
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const existing = await accessRepo.getAccessRole(ctx.tenantId, roleId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Rol no encontrado')
        const body = patchAccessRoleBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const existing = await accessRepo.getAccessRole(ctx.tenantId, roleId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Rol no encontrado')
        await accessRepo.deleteAccessRole(ctx.tenantId, roleId)
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'access' && seg[2] === 'users' && seg.length === 3) {
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const items = await accessRepo.listTenantUserProfiles(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'access' && seg[2] === 'users' && seg[3] && seg.length === 4) {
      const targetSub = seg[3]
      if (method === 'PATCH') {
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const body = patchAccessUserBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const existing = await accessRepo.getTenantUserProfile(ctx.tenantId, targetSub)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Usuario no encontrado en este tenant')
        const now = new Date().toISOString()
        const rbacAssignments =
          body.data.rbacAssignments !== undefined
            ? normalizeRbacAssignmentsInput(ctx.tenantId, targetSub, body.data.rbacAssignments)
            : existing.rbacAssignments
        const updated: TenantUserProfile = {
          ...existing,
          ...body.data,
          rbacAssignments,
          updatedAt: now,
        }
        await accessRepo.putTenantUserProfile(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'access' && seg[2] === 'me' && seg.length === 3) {
      const sub = ctx.subject
      if (!sub) return auditedJsonError(ctx, event, 401, 'UNAUTHORIZED', 'Token sin subject (sub)')
      if (method === 'GET') {
        const p = await accessRepo.getTenantUserProfile(ctx.tenantId, sub)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Perfil no registrado; use PUT para crearlo')
        return finalizeAudit(
          ctx,
          event,
          json(200, {
            ...p,
            rbac: {
              mode: rbacState.mode,
              effectivePermissions: effectivePermissionsPreview(rbacState),
            },
          }),
        )
      }
      if (method === 'PUT') {
        const body = putSelfUserProfileBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'asset:read', {})
        if (denied) return denied
        const items = await repo.listPortfolios(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const denied = requireRbac(ctx, event, rbacState, 'asset:write', {})
        if (denied) return denied
        const body = createPortfolioBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'asset:read', { portfolioId: id })
        if (denied) return denied
        const p = await repo.getPortfolio(ctx.tenantId, id)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Portfolio no encontrado')
        return finalizeAudit(ctx, event, json(200, p))
      }
      if (method === 'PATCH') {
        const denied = requireRbac(ctx, event, rbacState, 'asset:write', { portfolioId: id })
        if (denied) return denied
        const p = await repo.getPortfolio(ctx.tenantId, id)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Portfolio no encontrado')
        const body = patchPortfolioBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', { portfolioId })
        if (denied) return denied
        const a = await repo.listAssetsByTenant(ctx.tenantId, { portfolioId })
        const packages = []
        for (const asset of a) {
          packages.push(await loadAssetFinancialPackage(ctx.tenantId, asset))
        }
        return finalizeAudit(ctx, event, json(200, aggregateFinancialPackages('portfolio', portfolioId, packages)))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[3] === 'cashflow' && seg.length === 4) {
      const portfolioId = seg[2]
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', { portfolioId })
        if (denied) return denied
        const a = await repo.listAssetsByTenant(ctx.tenantId, { portfolioId })
        const series = []
        for (const asset of a) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = await computeAssetMetricsForAsset(ctx.tenantId, asset, rev, cost)
          series.push({ assetId: asset.id, cashFlow: m.cashFlow })
        }
        return finalizeAudit(ctx, event, json(200, { portfolioId, series }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[3] === 'performance' && seg.length === 4) {
      const portfolioId = seg[2]
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', { portfolioId })
        if (denied) return denied
        const a = await repo.listAssetsByTenant(ctx.tenantId, { portfolioId })
        const totalCap = a.reduce((s, x) => s + x.initialInvestment, 0)
        let weightedRoi = 0
        for (const asset of a) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = await computeAssetMetricsForAsset(ctx.tenantId, asset, rev, cost)
          const w = totalCap > 0 ? asset.initialInvestment / totalCap : 0
          weightedRoi += m.roi * w
        }
        return finalizeAudit(ctx, event, json(200, { portfolioId, totalCapitalDeployed: totalCap, weightedROI: weightedRoi }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'portfolios' && seg[3] === 'capital-participation' && seg.length === 4) {
      const portfolioId = seg[2]
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', { portfolioId })
        if (denied) return denied
        const view = await buildPortfolioCapitalParticipation(ctx.tenantId, portfolioId)
        if (!view) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Portfolio no encontrado')
        return finalizeAudit(ctx, event, json(200, view))
      }
    }

    // --- projects ---
    if (seg[0] === 'v1' && seg[1] === 'projects' && seg.length === 2) {
      if (method === 'GET') {
        const q = event.queryStringParameters?.portfolioId
        const denied = requireRbac(ctx, event, rbacState, 'asset:read', { portfolioId: q })
        if (denied) return denied
        const items = await repo.listProjects(ctx.tenantId, q)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const body = createProjectBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const denied = requireRbac(ctx, event, rbacState, 'asset:write', { portfolioId: body.data.portfolioId })
        if (denied) return denied
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
        await ensureDefaultActualScenarioForProject({
          tenantId: ctx.tenantId,
          portfolioId: p.portfolioId,
          projectId: p.id,
          createdBy: ctx.subject,
        })
        return finalizeAudit(ctx, event, json(201, p))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[2] && seg.length === 3) {
      const id = seg[2]
      if (method === 'GET') {
        const p = await repo.getProject(ctx.tenantId, id)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        const denied = requireRbac(ctx, event, rbacState, 'asset:read', {
          portfolioId: p.portfolioId,
          projectId: id,
        })
        if (denied) return denied
        return finalizeAudit(ctx, event, json(200, p))
      }
      if (method === 'PATCH') {
        const p = await repo.getProject(ctx.tenantId, id)
        if (!p) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        const denied = requireRbac(ctx, event, rbacState, 'asset:write', {
          portfolioId: p.portfolioId,
          projectId: id,
        })
        if (denied) return denied
        const body = patchProjectBody.safeParse(parseBody(event))
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
        const pj = await repo.getProject(ctx.tenantId, projectId)
        if (!pj) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: pj.portfolioId,
          projectId,
        })
        if (denied) return denied
        const loaded = await loadProjectAssetsForScenarioMetrics(
          ctx.tenantId,
          projectId,
          event.queryStringParameters ?? null,
        )
        if (!loaded.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', loaded.message)
        const a = loaded.assets
        const packages = []
        for (const asset of a) {
          packages.push(await loadAssetFinancialPackage(ctx.tenantId, asset))
        }
        return finalizeAudit(
          ctx,
          event,
          json(200, {
            ...aggregateFinancialPackages('project', projectId, packages),
            scenario: loaded.meta,
          }),
        )
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[3] === 'cashflow' && seg.length === 4) {
      const projectId = seg[2]
      if (method === 'GET') {
        const pj = await repo.getProject(ctx.tenantId, projectId)
        if (!pj) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: pj.portfolioId,
          projectId,
        })
        if (denied) return denied
        const loaded = await loadProjectAssetsForScenarioMetrics(
          ctx.tenantId,
          projectId,
          event.queryStringParameters ?? null,
        )
        if (!loaded.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', loaded.message)
        const a = loaded.assets
        const series = []
        for (const asset of a) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = await computeAssetMetricsForAsset(ctx.tenantId, asset, rev, cost)
          series.push({ assetId: asset.id, cashFlow: m.cashFlow })
        }
        return finalizeAudit(ctx, event, json(200, { scenario: loaded.meta, projectId, series }))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'projects' && seg[3] === 'investor-allocations' && seg.length === 4) {
      const projectId = seg[2]
      if (method === 'PUT') {
        const pj = await repo.getProject(ctx.tenantId, projectId)
        if (!pj) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {
          portfolioId: pj.portfolioId,
          projectId,
        })
        if (denied) return denied
        const body = putProjectInvestorAllocationsBody.safeParse(parseBody(event))
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
        const pj = await repo.getProject(ctx.tenantId, projectId)
        if (!pj) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {
          portfolioId: pj.portfolioId,
          projectId,
        })
        if (denied) return denied
        const view = await buildProjectCapitalParticipation(ctx.tenantId, projectId)
        if (!view) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Proyecto no encontrado')
        return finalizeAudit(ctx, event, json(200, view))
      }
    }

    // --- dashboard / insights ---
    if (seg[0] === 'v1' && seg[1] === 'dashboard' && seg[2] === 'executive' && seg.length === 3) {
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const loaded = await loadTenantAssetsForExecutiveDashboard(ctx.tenantId, event.queryStringParameters ?? null)
        if (!loaded.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', loaded.message)
        const assets = loaded.assets
        const totalCap = assets.reduce((s, x) => s + x.initialInvestment, 0)
        let totalRev = 0
        let totalCost = 0
        const rows = []
        for (const asset of assets) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = await computeAssetMetricsForAsset(ctx.tenantId, asset, rev, cost)
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
          const m = await computeAssetMetricsForAsset(ctx.tenantId, asset, rev, cost)
          wSum += m.roi * (asset.initialInvestment / (totalCap || 1))
        }
        const portfolioROI = totalCap ? (netCashFlowYTD / totalCap) * 100 : 0
        // IRR promedio simple
        let irrSum = 0
        for (const asset of assets) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = await computeAssetMetricsForAsset(ctx.tenantId, asset, rev, cost)
          irrSum += m.irr
        }
        const irrAvg = assets.length ? irrSum / assets.length : 0

        return finalizeAudit(ctx, event, json(200, {
          scenario: loaded.meta,
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
        const denied = requireRbac(ctx, event, rbacState, 'financial:analyze', {})
        if (denied) return denied
        const loaded = await loadTenantAssetsForExecutiveDashboard(ctx.tenantId, event.queryStringParameters ?? null)
        if (!loaded.ok) return auditedJsonError(ctx, event, 400, 'VALIDATION', loaded.message)
        const assets = loaded.assets
        const enriched = []
        for (const asset of assets) {
          const rev = await repo.listRevenueFacts(ctx.tenantId, asset.id)
          const cost = await repo.listCostFacts(ctx.tenantId, asset.id)
          const m = await computeAssetMetricsForAsset(ctx.tenantId, asset, rev, cost)
          enriched.push({ id: asset.id, name: asset.name, metrics: m })
        }
        return finalizeAudit(ctx, event, json(200, {
          scenario: loaded.meta,
          items: buildInsights(ctx.tenantId, enriched),
        }))
      }
    }

    // --- reports (JSON para UI y exportación CSV en cliente) ---
    if (seg[0] === 'v1' && seg[1] === 'reports' && seg.length === 3) {
      const kind = seg[2]
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
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
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const items = await repo.listInvestors(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const body = createInvestorBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        return finalizeAudit(ctx, event, json(200, inv))
      }
      if (method === 'PATCH') {
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const existing = await repo.getInvestor(ctx.tenantId, investorId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        const body = patchInvestorBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const now = new Date().toISOString()
        const updated: Investor = { ...existing, ...body.data, updatedAt: now }
        await repo.putInvestor(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const existing = await repo.getInvestor(ctx.tenantId, investorId)
        if (!existing) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        await repo.deleteInvestor(ctx.tenantId, investorId)
        return finalizeAudit(ctx, event, noContent())
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg[3] === 'ledger' && seg.length === 4) {
      const investorId = seg[2]
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const entries = await repo.listInvestorLedgerEntries(ctx.tenantId, investorId)
        const items = [...entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const denied = requireRbac(ctx, event, rbacState, 'user:manage', {})
        if (denied) return denied
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        const body = investorLedgerEntryBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        const acc = await buildInvestorCapitalAccount(ctx.tenantId, inv)
        return finalizeAudit(ctx, event, json(200, acc))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'investors' && seg[2] && seg[3] === 'exposure' && seg.length === 4) {
      const investorId = seg[2]
      if (method === 'GET') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const inv = await repo.getInvestor(ctx.tenantId, investorId)
        if (!inv) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Inversionista no encontrado')
        const exp = await buildInvestorExposure(ctx.tenantId, inv)
        return finalizeAudit(ctx, event, json(200, exp))
      }
    }

    // --- imports ---
    if (seg[0] === 'v1' && seg[1] === 'imports' && seg[2] === 'assets' && seg.length === 3) {
      if (method === 'POST') {
        const denied = requireRbac(ctx, event, rbacState, 'operation:write', {})
        if (denied) return denied
        const body = importAssetsBody.safeParse(parseBody(event))
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
              await ensureDefaultActualScenarioForProject({
                tenantId: ctx.tenantId,
                portfolioId: row.portfolioId,
                projectId: row.projectId,
                createdBy: ctx.subject,
              })
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
        const denied = requireRbac(ctx, event, rbacState, 'operation:write', {})
        if (denied) return denied
        const j = await repo.getImportJob(ctx.tenantId, jobId)
        if (!j) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Job no encontrado')
        return finalizeAudit(ctx, event, json(200, j))
      }
    }

    if (seg[0] === 'v1' && seg[1] === 'imports' && seg[2] === 'tms-rates' && seg.length === 3) {
      if (method === 'POST') {
        const denied = requireRbac(ctx, event, rbacState, 'operation:write', {})
        if (denied) return denied
        const body = importTmsRatesBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'operation:write', {})
        if (denied) return denied
        const body = importTmsOrderTripsBody.safeParse(parseBody(event))
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
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const items = await repo.listSimulations(ctx.tenantId)
        return finalizeAudit(ctx, event, json(200, { items }))
      }
      if (method === 'POST') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:analyze', {})
        if (denied) return denied
        const body = simulationBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const b = body.data
        const now = new Date().toISOString()
        const id = newId.simulation()
        const projection = computeSimulationProjection({
          initialCapital: b.initialCapital,
          expectedMonthlyRevenue: b.expectedMonthlyRevenue,
          expectedOperatingCost: b.expectedOperatingCost,
          growthRatePercent: b.growthRatePercent,
          revenueGrowthRatePercent: b.revenueGrowthRatePercent,
          costGrowthRatePercent: b.costGrowthRatePercent,
          durationMonths: b.durationMonths,
          discountRateAnnual: b.discountRateAnnual,
          financing: b.financing ?? null,
        })
        const simulation: Simulation = {
          id,
          tenantId: ctx.tenantId,
          name: b.name,
          assetType: b.assetType,
          initialCapital: b.initialCapital,
          expectedMonthlyRevenue: b.expectedMonthlyRevenue,
          expectedOperatingCost: b.expectedOperatingCost,
          growthRatePercent: b.growthRatePercent,
          revenueGrowthRatePercent: b.revenueGrowthRatePercent,
          costGrowthRatePercent: b.costGrowthRatePercent,
          durationMonths: b.durationMonths,
          discountRateAnnual: b.discountRateAnnual,
          financing: b.financing ?? null,
          equityMetrics: projection.equityMetrics,
          projectedROI: projection.roi,
          projectedIRR: projection.irr,
          projectedNPV: projection.npv,
          breakEvenMonth: projection.breakEvenMonth,
          calculationVersion: SIMULATION_CALCULATION_VERSION,
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
        const denied = requireRbac(ctx, event, rbacState, 'financial:read', {})
        if (denied) return denied
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Simulación no encontrada')
        return finalizeAudit(ctx, event, json(200, sim))
      }
      if (method === 'PATCH') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:analyze', {})
        if (denied) return denied
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Simulación no encontrada')
        const body = patchSimulationBody.safeParse(parseBody(event))
        if (!body.success) return auditedJsonError(ctx, event, 400, 'VALIDATION', 'Body inválido', body.error.flatten())
        const merged = { ...sim, ...body.data }
        const financing =
          body.data.financing === undefined ? sim.financing : body.data.financing === null ? null : body.data.financing
        const projection = computeSimulationProjection({
          initialCapital: merged.initialCapital,
          expectedMonthlyRevenue: merged.expectedMonthlyRevenue,
          expectedOperatingCost: merged.expectedOperatingCost,
          growthRatePercent: merged.growthRatePercent,
          revenueGrowthRatePercent: merged.revenueGrowthRatePercent,
          costGrowthRatePercent: merged.costGrowthRatePercent,
          durationMonths: merged.durationMonths,
          discountRateAnnual: merged.discountRateAnnual,
          financing,
        })
        const updated: Simulation = {
          ...merged,
          financing,
          equityMetrics: projection.equityMetrics,
          projectedROI: projection.roi,
          projectedIRR: projection.irr,
          projectedNPV: projection.npv,
          breakEvenMonth: projection.breakEvenMonth,
          calculationVersion: SIMULATION_CALCULATION_VERSION,
          updatedAt: new Date().toISOString(),
        }
        await repo.putSimulation(updated)
        return finalizeAudit(ctx, event, json(200, updated))
      }
      if (method === 'DELETE') {
        const denied = requireRbac(ctx, event, rbacState, 'financial:analyze', {})
        if (denied) return denied
        const sim = await repo.getSimulation(ctx.tenantId, simulationId)
        if (!sim) return auditedJsonError(ctx, event, 404, 'NOT_FOUND', 'Simulación no encontrada')
        await repo.deleteSimulation(ctx.tenantId, simulationId)
        return finalizeAudit(ctx, event, noContent())
      }
    }

    // --- TMS (operacional → RevenueFact / CostFact; sin métricas en TMS) ---
    if (seg[0] === 'v1' && seg[1] === 'tms') {
      const isWrite = ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)
      const deniedTms = requireRbac(ctx, event, rbacState, isWrite ? 'operation:write' : 'asset:read', {})
      if (deniedTms) return deniedTms
    }

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
        const body = createTmsCustomerBody.safeParse(parseBody(event))
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
        const body = patchTmsCustomerBody.safeParse(parseBody(event))
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
        const body = createTmsLocalityBody.safeParse(parseBody(event))
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
        const body = patchTmsLocalityBody.safeParse(parseBody(event))
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
        const body = createTmsProviderBody.safeParse(parseBody(event))
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
        const body = patchTmsProviderBody.safeParse(parseBody(event))
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
        const body = createTmsDriverBody.safeParse(parseBody(event))
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
        const body = createTmsVehicleUnitBody.safeParse(parseBody(event))
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
          code: body.data.code ?? randomUUID(),
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
        const body = createTmsRateBody.safeParse(parseBody(event))
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
        const body = createTmsRouteBody.safeParse(parseBody(event))
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
        const body = createTransportOrderBody.safeParse(parseBody(event))
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
        const body = patchTransportOrderBody.safeParse(parseBody(event))
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
        const body = createTransportTripBody.safeParse(parseBody(event))
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
        const body = patchTransportTripBody.safeParse(parseBody(event))
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
        const body = tmsTripCostBody.safeParse(parseBody(event))
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
        const body = tmsTripRevenueBody.safeParse(parseBody(event))
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

    const docRoute = await tryRouteDocuments(ctx, event, method, seg, rbacState)
    if (docRoute) return docRoute

    const flipRoute = await tryRouteFlipping(ctx, event, method, seg, rbacState)
    if (flipRoute) return flipRoute

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
