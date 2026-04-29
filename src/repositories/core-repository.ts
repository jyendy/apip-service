import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import type {
  Asset,
  AssetFinancing,
  BillingIntent,
  CapitalContribution,
  CostFact,
  ImportJob,
  Investor,
  InvestorLedgerEntry,
  OccupancyRecord,
  Portfolio,
  Project,
  ProjectInvestorAllocation,
  RevenueFact,
  Scenario,
  Simulation,
  Tenant,
  TenantBilling,
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
import * as keys from '../lib/keys'
import { getDocumentClient, tableName } from './dynamo-client'

const ENTITY = {
  TENANT: 'TENANT',
  TENANT_REGISTRY: 'TENANT_REGISTRY',
  PORTFOLIO: 'PORTFOLIO',
  PROJECT: 'PROJECT',
  ASSET: 'ASSET',
  FINANCING: 'FINANCING',
  REV_FACT: 'REV_FACT',
  COST_FACT: 'COST_FACT',
  IMPORT: 'IMPORT',
  SIMULATION: 'SIMULATION',
  INVESTOR: 'INVESTOR',
  INV_LEDGER: 'INV_LEDGER',
  PROJ_ALLOC: 'PROJ_ALLOC',
  TMS_ORDER: 'TMS_ORDER',
  TMS_TRIP: 'TMS_TRIP',
  TMS_CUSTOMER: 'TMS_CUSTOMER',
  TMS_LOCALITY: 'TMS_LOCALITY',
  TMS_PROVIDER: 'TMS_PROVIDER',
  TMS_DRIVER: 'TMS_DRIVER',
  TMS_VEHICLE_UNIT: 'TMS_VEHICLE_UNIT',
  TMS_RATE: 'TMS_RATE',
  TMS_ROUTE: 'TMS_ROUTE',
  SCENARIO: 'SCENARIO',
  ONBOARDING_REQUEST: 'ONBOARDING_REQUEST',
  CAPITAL_CONTRIBUTION: 'CAPITAL_CONTRIBUTION',
  OCCUPANCY_RECORD: 'OCCUPANCY_RECORD',
} as const

type CoreItem = Record<string, unknown> & { PK: string; SK: string }

function baseItem(tenantId: string, sk: string, rest: Record<string, unknown>): CoreItem {
  return { PK: keys.pkTenant(tenantId), SK: sk, tenantId, ...rest }
}

export function normalizeTransportOrder(raw: Record<string, unknown>): TransportOrder {
  const originLabel = String(raw.originLabel ?? raw.origin ?? '')
  const destinationLabel = String(raw.destinationLabel ?? raw.destination ?? '')
  return {
    ...(raw as unknown as TransportOrder),
    customerName: String(raw.customerName ?? ''),
    originLabel,
    destinationLabel,
    customerId: raw.customerId as string | undefined,
    originLocalityId: raw.originLocalityId as string | undefined,
    destinationLocalityId: raw.destinationLocalityId as string | undefined,
  }
}

export async function putTenant(t: Tenant): Promise<void> {
  const ddb = getDocumentClient()
  const item = baseItem(t.id, keys.skTenantMeta(), {
    entityType: ENTITY.TENANT,
    ...t,
  })
  await ddb.send(new PutCommand({ TableName: tableName(), Item: item }))
  await putTenantRegistryEntry(t)
}

/** Índice de listado para admin (PK fija PLATFORM#REGISTRY). */
async function putTenantRegistryEntry(t: Tenant): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: keys.pkPlatformRegistry(),
        SK: keys.skTenantRegistryEntry(t.id),
        entityType: ENTITY.TENANT_REGISTRY,
        tenantId: t.id,
        name: t.name,
        type: t.type,
        createdAt: t.createdAt,
        billing: t.billing,
      },
    }),
  )
}

export async function listTenants(): Promise<Tenant[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkPlatformRegistry(),
        ':pfx': 'TENANT#',
      },
    }),
  )
  const rows = (r.Items ?? []) as CoreItem[]
  return rows.map(row => ({
    id: String(row.tenantId),
    name: String(row.name),
    type: row.type as Tenant['type'],
    createdAt: String(row.createdAt),
    billing: row.billing as TenantBilling | undefined,
  }))
}

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTenantMeta() },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TENANT) return null
  return r.Item as unknown as Tenant
}

export async function putBillingIntent(intent: BillingIntent): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: keys.pkPlatformRegistry(),
        SK: keys.skOnboardingRequest(intent.createdAt, intent.id),
        entityType: ENTITY.ONBOARDING_REQUEST,
        ...intent,
      },
    }),
  )
  // Índice por email para lookup/dedupe.
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: keys.pkOnboardingByEmail(intent.email),
        SK: keys.skOnboardingByEmail(intent.createdAt, intent.id),
        entityType: ENTITY.ONBOARDING_REQUEST,
        requestId: intent.id,
        email: intent.email,
        createdAt: intent.createdAt,
        status: intent.status,
        planCode: intent.planCode,
        billingCycle: intent.billingCycle,
      },
    }),
  )
}

export async function listBillingIntents(): Promise<BillingIntent[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkPlatformRegistry(),
        ':pfx': 'ONBOARDING#',
      },
      ScanIndexForward: false,
    }),
  )
  return (r.Items ?? [])
    .filter(x => (x as CoreItem).entityType === ENTITY.ONBOARDING_REQUEST)
    .map(x => x as unknown as BillingIntent)
}

export async function getBillingIntent(intentId: string): Promise<BillingIntent | null> {
  const items = await listBillingIntents()
  return items.find(i => i.id === intentId) ?? null
}

export async function getLatestBillingIntentByEmail(email: string): Promise<BillingIntent | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkOnboardingByEmail(email),
        ':pfx': 'REQ#',
      },
      ScanIndexForward: false,
      Limit: 1,
    }),
  )
  const first = (r.Items ?? [])[0] as (CoreItem & { requestId?: string }) | undefined
  if (!first?.requestId) return null
  return await getBillingIntent(String(first.requestId))
}

/**
 * Rate limit simple (TTL): crea un token por `kind`+`key` si no existe.
 * Si ya existe, se considera excedido. Útil para frenar spam.
 */
export async function tryAcquireOnboardingRateLimit(
  kind: 'ip' | 'email',
  key: string,
  ttlSeconds: number,
): Promise<boolean> {
  const ddb = getDocumentClient()
  const nowSec = Math.floor(Date.now() / 1000)
  const expiresAt = nowSec + Math.max(10, ttlSeconds)
  const pk = keys.pkPlatformRateLimit()
  const sk = keys.skOnboardingRateLimit(kind, key)

  // OJO: TTL de Dynamo no elimina de forma inmediata; por eso validamos expiresAt en lectura.
  const current = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: pk, SK: sk },
    }),
  )
  const activeUntil = Number((current.Item as { expiresAt?: unknown } | undefined)?.expiresAt ?? 0)
  if (Number.isFinite(activeUntil) && activeUntil > nowSec) {
    return false
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: pk,
        SK: sk,
        entityType: 'RATE_LIMIT',
        expiresAt,
      },
    }),
  )
  return true
}

export async function putPortfolio(p: Portfolio): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(p.tenantId, keys.skPortfolio(p.id), {
        entityType: ENTITY.PORTFOLIO,
        ...p,
      }),
    }),
  )
}

export async function getPortfolio(tenantId: string, portfolioId: string): Promise<Portfolio | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skPortfolio(portfolioId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.PORTFOLIO) return null
  return r.Item as unknown as Portfolio
}

export async function listPortfolios(tenantId: string): Promise<Portfolio[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'PORTFOLIO#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as Portfolio[]
}

export async function putProject(p: Project): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(p.tenantId, keys.skProject(p.id), {
        entityType: ENTITY.PROJECT,
        ...p,
      }),
    }),
  )
}

export async function getProject(tenantId: string, projectId: string): Promise<Project | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skProject(projectId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.PROJECT) return null
  return r.Item as unknown as Project
}

export async function listProjects(tenantId: string, portfolioId?: string): Promise<Project[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'PROJECT#',
      },
    }),
  )
  let rows = (r.Items ?? []) as unknown as Project[]
  if (portfolioId) rows = rows.filter(x => x.portfolioId === portfolioId)
  return rows
}

export async function putAsset(a: Asset): Promise<void> {
  const ddb = getDocumentClient()
  const item = baseItem(a.tenantId, keys.skAsset(a.id), {
    entityType: ENTITY.ASSET,
    GSI1PK: keys.gsi1pkProjectAssets(a.tenantId, a.projectId),
    GSI1SK: keys.gsi1skAsset(a.id),
    GSI2PK: keys.gsi2pkAssetType(a.tenantId, a.type),
    GSI2SK: keys.gsi2skAsset(a.id),
    ...a,
  })
  await ddb.send(new PutCommand({ TableName: tableName(), Item: item }))
}

export async function getAsset(tenantId: string, assetId: string): Promise<Asset | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skAsset(assetId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.ASSET) return null
  return r.Item as unknown as Asset
}

export async function deleteAssetItem(tenantId: string, assetId: string): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skAsset(assetId) },
    }),
  )
}

export async function listAssetsByTenant(
  tenantId: string,
  opts: { projectId?: string; portfolioId?: string; type?: Asset['type'] },
): Promise<Asset[]> {
  if (opts.projectId) {
    const ddb = getDocumentClient()
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gpk',
        ExpressionAttributeValues: {
          ':gpk': keys.gsi1pkProjectAssets(tenantId, opts.projectId),
        },
      }),
    )
    return (r.Items ?? []) as unknown as Asset[]
  }
  if (opts.type) {
    const ddb = getDocumentClient()
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :gpk',
        ExpressionAttributeValues: {
          ':gpk': keys.gsi2pkAssetType(tenantId, opts.type),
        },
      }),
    )
    return (r.Items ?? []) as unknown as Asset[]
  }
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      FilterExpression: 'entityType = :et',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'ASSET#',
        ':et': ENTITY.ASSET,
      },
    }),
  )
  let rows = (r.Items ?? []) as unknown as Asset[]
  if (opts.portfolioId) rows = rows.filter(a => a.portfolioId === opts.portfolioId)
  return rows
}

export async function listRevenueFacts(tenantId: string, assetId: string): Promise<RevenueFact[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': `ASSET#${assetId}#REV#`,
      },
    }),
  )
  return (r.Items ?? []) as unknown as RevenueFact[]
}

export async function listCostFacts(tenantId: string, assetId: string): Promise<CostFact[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': `ASSET#${assetId}#COST#`,
      },
    }),
  )
  return (r.Items ?? []) as unknown as CostFact[]
}

export async function putRevenueFact(f: RevenueFact): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(f.tenantId, keys.skRevenueFact(f.assetId, f.id), {
        entityType: ENTITY.REV_FACT,
        ...f,
      }),
    }),
  )
}

export async function putCostFact(f: CostFact): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(f.tenantId, keys.skCostFact(f.assetId, f.id), {
        entityType: ENTITY.COST_FACT,
        ...f,
      }),
    }),
  )
}

export async function putCapitalContribution(c: CapitalContribution): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(c.tenantId, keys.skCapitalContribution(c.assetId, c.id), {
        entityType: ENTITY.CAPITAL_CONTRIBUTION,
        ...c,
      }),
    }),
  )
}

export async function listCapitalContributions(tenantId: string, assetId: string): Promise<CapitalContribution[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': `ASSET#${assetId}#CAPITAL#`,
      },
    }),
  )
  return (r.Items ?? []) as unknown as CapitalContribution[]
}

export async function putOccupancyRecord(o: OccupancyRecord): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(o.tenantId, keys.skOccupancyRecord(o.assetId, o.month, o.id), {
        entityType: ENTITY.OCCUPANCY_RECORD,
        ...o,
      }),
    }),
  )
}

export async function listOccupancyRecords(tenantId: string, assetId: string): Promise<OccupancyRecord[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': `ASSET#${assetId}#OCC#`,
      },
    }),
  )
  return (r.Items ?? []) as unknown as OccupancyRecord[]
}

export async function deleteFactsForAsset(tenantId: string, assetId: string): Promise<void> {
  const rev = await listRevenueFacts(tenantId, assetId)
  const cost = await listCostFacts(tenantId, assetId)
  const ddb = getDocumentClient()
  const fixDeletes = [
    ...rev.map(f => ({
      DeleteRequest: { Key: { PK: keys.pkTenant(tenantId), SK: keys.skRevenueFact(assetId, f.id) } },
    })),
    ...cost.map(f => ({
      DeleteRequest: { Key: { PK: keys.pkTenant(tenantId), SK: keys.skCostFact(assetId, f.id) } },
    })),
  ]
  for (let i = 0; i < fixDeletes.length; i += 25) {
    const chunk = fixDeletes.slice(i, i + 25)
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [tableName()]: chunk },
      }),
    )
  }
}

function rowToFinancing(row: CoreItem): AssetFinancing {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    assetId: String(row.assetId),
    principal: Number(row.principal),
    annualInterestRate: Number(row.annualInterestRate),
    termMonths: Number(row.termMonths),
    startDate: String(row.startDate),
    amortizationType: 'french',
    downPayment: Number(row.downPayment),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export async function getFinancing(tenantId: string, assetId: string): Promise<AssetFinancing | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skAssetFinancing(assetId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.FINANCING) return null
  return rowToFinancing(r.Item as CoreItem)
}

export async function putFinancing(f: AssetFinancing): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(f.tenantId, keys.skAssetFinancing(f.assetId), {
        entityType: ENTITY.FINANCING,
        ...f,
      }),
    }),
  )
}

export async function deleteFinancingForAsset(tenantId: string, assetId: string): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skAssetFinancing(assetId) },
    }),
  )
}

export async function putInvestor(inv: Investor): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(inv.tenantId, keys.skInvestor(inv.id), {
        entityType: ENTITY.INVESTOR,
        ...inv,
      }),
    }),
  )
}

export async function getInvestor(tenantId: string, investorId: string): Promise<Investor | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skInvestor(investorId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.INVESTOR) return null
  return r.Item as unknown as Investor
}

export async function listInvestors(tenantId: string): Promise<Investor[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'INVESTOR#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as Investor[]
}

export async function putInvestorLedgerEntry(e: InvestorLedgerEntry): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(e.tenantId, keys.skInvestorLedger(e.investorId, e.id), {
        entityType: ENTITY.INV_LEDGER,
        ...e,
      }),
    }),
  )
}

export async function listInvestorLedgerEntries(tenantId: string, investorId: string): Promise<InvestorLedgerEntry[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': `INV#${investorId}#LEDGER#`,
      },
    }),
  )
  return (r.Items ?? []) as unknown as InvestorLedgerEntry[]
}

export async function putProjectInvestorAllocation(a: ProjectInvestorAllocation): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(a.tenantId, keys.skProjectAllocation(a.projectId, a.investorId), {
        entityType: ENTITY.PROJ_ALLOC,
        ...a,
      }),
    }),
  )
}

export async function deleteProjectInvestorAllocation(
  tenantId: string,
  projectId: string,
  investorId: string,
): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skProjectAllocation(projectId, investorId) },
    }),
  )
}

export async function listProjectInvestorAllocations(
  tenantId: string,
  projectId: string,
): Promise<ProjectInvestorAllocation[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': `PROJALLOC#${projectId}#`,
      },
    }),
  )
  return (r.Items ?? []) as unknown as ProjectInvestorAllocation[]
}

export async function deleteInvestor(tenantId: string, investorId: string): Promise<void> {
  const ledgers = await listInvestorLedgerEntries(tenantId, investorId)
  const ddb = getDocumentClient()
  for (const e of ledgers) {
    await ddb.send(
      new DeleteCommand({
        TableName: tableName(),
        Key: { PK: keys.pkTenant(tenantId), SK: keys.skInvestorLedger(e.investorId, e.id) },
      }),
    )
  }
  const projects = await listProjects(tenantId)
  for (const p of projects) {
    const allocs = await listProjectInvestorAllocations(tenantId, p.id)
    for (const a of allocs) {
      if (a.investorId === investorId) {
        await deleteProjectInvestorAllocation(tenantId, p.id, investorId)
      }
    }
  }
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skInvestor(investorId) },
    }),
  )
}

export async function putImportJob(job: ImportJob): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(job.tenantId, keys.skImportJob(job.id), {
        entityType: ENTITY.IMPORT,
        ...job,
      }),
    }),
  )
}

export async function getImportJob(tenantId: string, jobId: string): Promise<ImportJob | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skImportJob(jobId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.IMPORT) return null
  return r.Item as unknown as ImportJob
}

export async function putSimulation(sim: Simulation): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(sim.tenantId, keys.skSimulation(sim.id), {
        entityType: ENTITY.SIMULATION,
        ...sim,
      }),
    }),
  )
}

export async function getSimulation(tenantId: string, simulationId: string): Promise<Simulation | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skSimulation(simulationId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.SIMULATION) return null
  return r.Item as unknown as Simulation
}

export async function listSimulations(tenantId: string): Promise<Simulation[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'SIMULATION#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as Simulation[]
}

export async function deleteSimulation(tenantId: string, simulationId: string): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skSimulation(simulationId) },
    }),
  )
}

export async function listTransportOrders(tenantId: string): Promise<TransportOrder[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#ORDER#',
      },
    }),
  )
  return (r.Items ?? []).map(item => normalizeTransportOrder(item as Record<string, unknown>))
}

export async function getTransportOrder(tenantId: string, orderId: string): Promise<TransportOrder | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsOrder(orderId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_ORDER) return null
  return normalizeTransportOrder(r.Item as Record<string, unknown>)
}

export async function putTransportOrder(o: TransportOrder): Promise<void> {
  const ddb = getDocumentClient()
  const item = baseItem(o.tenantId, keys.skTmsOrder(o.id), {
    entityType: ENTITY.TMS_ORDER,
    ...o,
  }) as Record<string, unknown>
  delete item.origin
  delete item.destination
  await ddb.send(new PutCommand({ TableName: tableName(), Item: item }))
}

export async function listTransportTrips(tenantId: string): Promise<TransportTrip[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#TRIP#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as TransportTrip[]
}

export async function getTransportTrip(tenantId: string, tripId: string): Promise<TransportTrip | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsTrip(tripId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_TRIP) return null
  return r.Item as unknown as TransportTrip
}

export async function putTransportTrip(t: TransportTrip): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(t.tenantId, keys.skTmsTrip(t.id), {
        entityType: ENTITY.TMS_TRIP,
        ...t,
      }),
    }),
  )
}

export async function listTmsCustomers(tenantId: string): Promise<TmsCustomer[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#CUSTOMER#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as TmsCustomer[]
}

export async function getTmsCustomer(tenantId: string, customerId: string): Promise<TmsCustomer | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsCustomer(customerId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_CUSTOMER) return null
  return r.Item as unknown as TmsCustomer
}

export async function putTmsCustomer(c: TmsCustomer): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(c.tenantId, keys.skTmsCustomer(c.id), {
        entityType: ENTITY.TMS_CUSTOMER,
        ...c,
      }),
    }),
  )
}

export async function deleteTmsCustomer(tenantId: string, customerId: string): Promise<void> {
  const orders = await listTransportOrders(tenantId)
  if (orders.some(o => o.customerId === customerId)) {
    throw new Error('TMS_CUSTOMER_IN_USE')
  }
  const ddb = getDocumentClient()
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsCustomer(customerId) },
    }),
  )
}

export async function listTmsLocalities(tenantId: string): Promise<TmsLocality[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#LOCALITY#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as TmsLocality[]
}

export async function getTmsLocality(tenantId: string, localityId: string): Promise<TmsLocality | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsLocality(localityId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_LOCALITY) return null
  return r.Item as unknown as TmsLocality
}

export async function putTmsLocality(l: TmsLocality): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(l.tenantId, keys.skTmsLocality(l.id), {
        entityType: ENTITY.TMS_LOCALITY,
        ...l,
      }),
    }),
  )
}

export async function listTmsProviders(tenantId: string): Promise<TmsTransportProvider[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#PROVIDER#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as TmsTransportProvider[]
}

export async function getTmsProvider(tenantId: string, providerId: string): Promise<TmsTransportProvider | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsProvider(providerId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_PROVIDER) return null
  return r.Item as unknown as TmsTransportProvider
}

export async function putTmsProvider(p: TmsTransportProvider): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(p.tenantId, keys.skTmsProvider(p.id), {
        entityType: ENTITY.TMS_PROVIDER,
        ...p,
      }),
    }),
  )
}

export async function listTmsDrivers(tenantId: string): Promise<TmsDriver[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#DRIVER#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as TmsDriver[]
}

export async function getTmsDriver(tenantId: string, driverId: string): Promise<TmsDriver | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsDriver(driverId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_DRIVER) return null
  return r.Item as unknown as TmsDriver
}

export async function putTmsDriver(d: TmsDriver): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(d.tenantId, keys.skTmsDriver(d.id), {
        entityType: ENTITY.TMS_DRIVER,
        ...d,
      }),
    }),
  )
}

export async function listTmsVehicleUnits(tenantId: string): Promise<TmsVehicleUnit[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#VEHICLE#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as TmsVehicleUnit[]
}

export async function getTmsVehicleUnit(tenantId: string, vehicleUnitId: string): Promise<TmsVehicleUnit | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsVehicleUnit(vehicleUnitId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_VEHICLE_UNIT) return null
  return r.Item as unknown as TmsVehicleUnit
}

export async function putTmsVehicleUnit(v: TmsVehicleUnit): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(v.tenantId, keys.skTmsVehicleUnit(v.id), {
        entityType: ENTITY.TMS_VEHICLE_UNIT,
        ...v,
      }),
    }),
  )
}

export async function listTmsRates(tenantId: string): Promise<TmsRate[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#RATE#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as TmsRate[]
}

export async function getTmsRate(tenantId: string, rateId: string): Promise<TmsRate | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsRate(rateId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_RATE) return null
  return r.Item as unknown as TmsRate
}

export async function putTmsRate(rate: TmsRate): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(rate.tenantId, keys.skTmsRate(rate.id), {
        entityType: ENTITY.TMS_RATE,
        ...rate,
      }),
    }),
  )
}

export async function listTmsRoutes(tenantId: string): Promise<TmsRoute[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'TMS#ROUTE#',
      },
    }),
  )
  return (r.Items ?? []) as unknown as TmsRoute[]
}

export async function getTmsRoute(tenantId: string, routeId: string): Promise<TmsRoute | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsRoute(routeId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.TMS_ROUTE) return null
  return r.Item as unknown as TmsRoute
}

export async function putTmsRoute(route: TmsRoute): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(route.tenantId, keys.skTmsRoute(route.id), {
        entityType: ENTITY.TMS_ROUTE,
        ...route,
      }),
    }),
  )
}

export async function deleteTmsLocality(tenantId: string, localityId: string): Promise<void> {
  const orders = await listTransportOrders(tenantId)
  if (
    orders.some(
      o => o.originLocalityId === localityId || o.destinationLocalityId === localityId,
    )
  ) {
    throw new Error('TMS_LOCALITY_IN_USE')
  }
  const ddb = getDocumentClient()
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skTmsLocality(localityId) },
    }),
  )
}

export async function putScenario(s: Scenario): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(s.tenantId, keys.skScenario(s.id), {
        entityType: ENTITY.SCENARIO,
        GSI4PK: keys.gsi4pkScenariosByProject(s.tenantId, s.projectId),
        GSI4SK: keys.gsi4skScenario(s.id),
        ...s,
      }),
    }),
  )
}

export async function getScenario(tenantId: string, scenarioId: string): Promise<Scenario | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skScenario(scenarioId) },
    }),
  )
  if (!r.Item || (r.Item as CoreItem).entityType !== ENTITY.SCENARIO) return null
  return r.Item as unknown as Scenario
}

export async function listScenariosByProject(tenantId: string, projectId: string): Promise<Scenario[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'GSI4',
      KeyConditionExpression: 'GSI4PK = :gpk',
      ExpressionAttributeValues: {
        ':gpk': keys.gsi4pkScenariosByProject(tenantId, projectId),
      },
    }),
  )
  const rows = (r.Items ?? []) as CoreItem[]
  return rows.filter(x => x.entityType === ENTITY.SCENARIO) as unknown as Scenario[]
}

export async function listAllScenariosForTenant(tenantId: string): Promise<Scenario[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      FilterExpression: 'entityType = :et',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'SCENARIO#',
        ':et': ENTITY.SCENARIO,
      },
    }),
  )
  return (r.Items ?? []) as unknown as Scenario[]
}

export async function deleteScenarioItem(tenantId: string, scenarioId: string): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skScenario(scenarioId) },
    }),
  )
}
