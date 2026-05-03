import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { Document, DocumentRequirement } from '../domain/types'
import * as keys from '../lib/keys'
import { getDocumentClient, tableName } from './dynamo-client'

const ENTITY_KIND = 'DOCUMENT'
const REQ_KIND = 'DOCUMENT_REQUIREMENT'

function normalizeDoc(raw: Record<string, unknown>): Document {
  return {
    id: String(raw.documentId ?? raw.id ?? ''),
    tenantId: String(raw.tenantId ?? ''),
    portfolioId: String(raw.portfolioId ?? ''),
    projectId: String(raw.projectId ?? ''),
    entityType: raw.entityType as Document['entityType'],
    entityId: String(raw.entityId ?? ''),
    name: String(raw.name ?? ''),
    fileName: String(raw.fileName ?? ''),
    mimeType: String(raw.mimeType ?? ''),
    size: Number(raw.size ?? 0),
    s3Key: String(raw.s3Key ?? ''),
    status: raw.status as Document['status'],
    required: Boolean(raw.required),
    requirementId: raw.requirementId as string | undefined,
    uploadedAt: raw.uploadedAt as string | undefined,
    validatedAt: raw.validatedAt as string | undefined,
    rejectedAt: raw.rejectedAt as string | undefined,
    rejectReason: raw.rejectReason as string | undefined,
    createdAt: String(raw.createdAt ?? ''),
  }
}

function normalizeReq(raw: Record<string, unknown>): DocumentRequirement {
  return {
    id: String(raw.requirementId ?? raw.id ?? ''),
    tenantId: String(raw.tenantId ?? ''),
    entityType: String(raw.docReqEntityType ?? raw.entityType ?? ''),
    name: String(raw.name ?? ''),
    description: raw.description as string | undefined,
    required: Boolean(raw.required),
    region: raw.region as string | undefined,
    createdAt: String(raw.createdAt ?? ''),
  }
}

export async function putDocument(doc: Document): Promise<void> {
  const ddb = getDocumentClient()
  const pk = keys.pkTenant(doc.tenantId)
  const sk = keys.skDocument(doc.id)
  const gsi3pk = keys.gsi3pkDocumentEntity(doc.tenantId, doc.entityType, doc.entityId)
  const gsi3sk = keys.gsi3skDocument(doc.id)
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: pk,
        SK: sk,
        entityKind: ENTITY_KIND,
        documentId: doc.id,
        tenantId: doc.tenantId,
        portfolioId: doc.portfolioId,
        projectId: doc.projectId,
        entityType: doc.entityType,
        entityId: doc.entityId,
        name: doc.name,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        size: doc.size,
        s3Key: doc.s3Key,
        status: doc.status,
        required: doc.required,
        requirementId: doc.requirementId,
        uploadedAt: doc.uploadedAt,
        validatedAt: doc.validatedAt,
        rejectedAt: doc.rejectedAt,
        rejectReason: doc.rejectReason,
        createdAt: doc.createdAt,
        GSI3PK: gsi3pk,
        GSI3SK: gsi3sk,
      },
    }),
  )
}

export async function getDocument(tenantId: string, documentId: string): Promise<Document | null> {
  const ddb = getDocumentClient()
  const res = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skDocument(documentId) },
    }),
  )
  const raw = res.Item as Record<string, unknown> | undefined
  if (!raw || raw.entityKind !== ENTITY_KIND) return null
  return normalizeDoc(raw)
}

export async function listDocumentsForEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<Document[]> {
  const ddb = getDocumentClient()
  const gsi3pk = keys.gsi3pkDocumentEntity(tenantId, entityType, entityId)
  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': gsi3pk },
    }),
  )
  const items = (res.Items ?? []) as Record<string, unknown>[]
  return items.filter(i => i.entityKind === ENTITY_KIND).map(normalizeDoc)
}

export async function listDocumentRequirements(
  tenantId: string,
  entityType: string,
): Promise<DocumentRequirement[]> {
  const ddb = getDocumentClient()
  const prefix = `DOCREQ#${entityType}#`
  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pref)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pref': prefix,
      },
    }),
  )
  const items = (res.Items ?? []) as Record<string, unknown>[]
  return items.filter(i => i.entityKind === REQ_KIND).map(normalizeReq)
}

export async function putDocumentRequirement(req: DocumentRequirement): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: keys.pkTenant(req.tenantId),
        SK: keys.skDocRequirement(req.entityType, req.id),
        entityKind: REQ_KIND,
        requirementId: req.id,
        tenantId: req.tenantId,
        docReqEntityType: req.entityType,
        name: req.name,
        description: req.description,
        required: req.required,
        region: req.region,
        createdAt: req.createdAt,
      },
    }),
  )
}
