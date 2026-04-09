import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

let doc: DynamoDBDocumentClient | null = null

export function getDocumentClient(): DynamoDBDocumentClient {
  if (!doc) {
    const low = new DynamoDBClient({})
    doc = DynamoDBDocumentClient.from(low, {
      marshallOptions: { removeUndefinedValues: true },
    })
  }
  return doc
}

export function tableName(): string {
  const t = process.env.APIP_TABLE_NAME
  if (!t) throw new Error('APIP_TABLE_NAME is not set')
  return t
}

export function auditTableName(): string | undefined {
  return process.env.APIP_AUDIT_TABLE_NAME
}
