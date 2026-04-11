import type { Handler } from 'aws-lambda'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import type { AuditRecordPayload } from './lib/audit'
import { getDocumentClient } from './repositories/dynamo-client'

const AUDIT_SOURCE = 'apip.audit'
const AUDIT_DETAIL_TYPE = 'AuditRecord'

type EbAuditEvent = {
  source: string
  'detail-type': string
  detail: AuditRecordPayload | string
}

function auditTable(): string {
  const t = process.env.APIP_AUDIT_TABLE_NAME
  if (!t) throw new Error('APIP_AUDIT_TABLE_NAME is not set')
  return t
}

/** Persiste en DynamoDB los eventos `apip.audit` / `AuditRecord` (bus default o custom). */
export const handler: Handler = async (raw: unknown) => {
  const ev = raw as EbAuditEvent
  if (ev.source !== AUDIT_SOURCE || ev['detail-type'] !== AUDIT_DETAIL_TYPE) {
    console.warn('audit-ingest: evento ignorado', ev.source, ev['detail-type'])
    return
  }
  const detail: AuditRecordPayload =
    typeof ev.detail === 'string' ? (JSON.parse(ev.detail) as AuditRecordPayload) : ev.detail
  const ddb = getDocumentClient()
  const pk = `TENANT#${detail.tenantId}`
  const sk = `AUDIT#${detail.occurredAt}#${detail.auditId}`
  await ddb.send(
    new PutCommand({
      TableName: auditTable(),
      Item: {
        PK: pk,
        SK: sk,
        entityType: 'AUDIT_ENTRY',
        ...detail,
      },
    }),
  )
}
