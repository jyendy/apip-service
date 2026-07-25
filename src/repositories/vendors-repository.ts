import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { Vendor } from '../domain/types'
import * as keys from '../lib/keys'
import { getDocumentClient, tableName } from './dynamo-client'

const ENTITY_TYPE = 'VENDOR'

export async function listVendors(tenantId: string): Promise<Vendor[]> {
  const ddb = getDocumentClient()
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':prefix': 'VENDOR#',
      },
    }),
  )
  return (result.Items ?? []) as unknown as Vendor[]
}

export async function getVendor(tenantId: string, vendorId: string): Promise<Vendor | null> {
  const ddb = getDocumentClient()
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skVendor(vendorId) },
    }),
  )
  if (!result.Item || result.Item.entityType !== ENTITY_TYPE) return null
  return result.Item as unknown as Vendor
}

export async function putVendor(vendor: Vendor): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: keys.pkTenant(vendor.tenantId),
        SK: keys.skVendor(vendor.id),
        entityType: ENTITY_TYPE,
        ...vendor,
      },
    }),
  )
}
