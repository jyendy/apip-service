import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import type {
  Asset,
  CostFact,
  ImportJob,
  Portfolio,
  Project,
  RevenueFact,
  Tenant,
} from '../domain/types'
import * as keys from '../lib/keys'
import { getDocumentClient, tableName } from './dynamo-client'

const ENTITY = {
  TENANT: 'TENANT',
  PORTFOLIO: 'PORTFOLIO',
  PROJECT: 'PROJECT',
  ASSET: 'ASSET',
  REV_FACT: 'REV_FACT',
  COST_FACT: 'COST_FACT',
  IMPORT: 'IMPORT',
} as const

type CoreItem = Record<string, unknown> & { PK: string; SK: string }

function baseItem(tenantId: string, sk: string, rest: Record<string, unknown>): CoreItem {
  return { PK: keys.pkTenant(tenantId), SK: sk, tenantId, ...rest }
}

export async function putTenant(t: Tenant): Promise<void> {
  const ddb = getDocumentClient()
  const item = baseItem(t.id, keys.skTenantMeta(), {
    entityType: ENTITY.TENANT,
    ...t,
  })
  await ddb.send(new PutCommand({ TableName: tableName(), Item: item }))
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
