import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { FlipDueDiligenceItem, FlipProject, FlipRehab } from '../domain/types'
import * as keys from '../lib/keys'
import { getDocumentClient, tableName } from './dynamo-client'

const ENTITY = {
  FLIP_PROJECT: 'FLIP_PROJECT',
  FLIP_DD: 'FLIP_DD',
  FLIP_REHAB: 'FLIP_REHAB',
} as const

type CoreItem = Record<string, unknown> & { PK: string; SK: string }

function baseItem(tenantId: string, sk: string, rest: Record<string, unknown>): CoreItem {
  return { PK: keys.pkTenant(tenantId), SK: sk, tenantId, ...rest }
}

export async function getFlipProject(tenantId: string, assetId: string): Promise<FlipProject | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skFlipProject(assetId) },
    }),
  )
  return (r.Item as FlipProject | undefined) ?? null
}

export async function putFlipProject(project: FlipProject): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(project.tenantId, keys.skFlipProject(project.assetId), {
        entityType: ENTITY.FLIP_PROJECT,
        ...project,
      }),
    }),
  )
}

export async function listFlipDueDiligenceItems(
  tenantId: string,
  assetId: string,
): Promise<FlipDueDiligenceItem[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': `FLIP#DD#${assetId}#`,
      },
    }),
  )
  return (r.Items ?? []) as unknown as FlipDueDiligenceItem[]
}

export async function getFlipDueDiligenceItem(
  tenantId: string,
  assetId: string,
  itemId: string,
): Promise<FlipDueDiligenceItem | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skFlipDueDiligenceItem(assetId, itemId) },
    }),
  )
  return (r.Item as FlipDueDiligenceItem | undefined) ?? null
}

export async function putFlipDueDiligenceItem(item: FlipDueDiligenceItem): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(item.tenantId, keys.skFlipDueDiligenceItem(item.assetId, item.id), {
        entityType: ENTITY.FLIP_DD,
        ...item,
      }),
    }),
  )
}

export async function listFlipRehabs(tenantId: string, assetId: string): Promise<FlipRehab[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': `FLIP#REHAB#${assetId}#`,
      },
    }),
  )
  return (r.Items ?? []) as unknown as FlipRehab[]
}

export async function getFlipRehab(
  tenantId: string,
  assetId: string,
  rehabId: string,
): Promise<FlipRehab | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skFlipRehab(assetId, rehabId) },
    }),
  )
  return (r.Item as FlipRehab | undefined) ?? null
}

export async function putFlipRehab(rehab: FlipRehab): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: baseItem(rehab.tenantId, keys.skFlipRehab(rehab.assetId, rehab.id), {
        entityType: ENTITY.FLIP_REHAB,
        ...rehab,
      }),
    }),
  )
}
