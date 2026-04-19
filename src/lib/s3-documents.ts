import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let client: S3Client | null = null

function getClient(): S3Client {
  if (!client) client = new S3Client({})
  return client
}

export function documentsBucketName(): string | undefined {
  const b = process.env.APIP_DOCUMENTS_BUCKET_NAME
  return b && b.trim() !== '' ? b.trim() : undefined
}

export function sanitizeFileSegment(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
  return s || 'file'
}

export function buildDocumentObjectKey(input: {
  tenantId: string
  portfolioId: string
  projectId: string
  entityType: string
  entityId: string
  documentId: string
  fileName: string
}): string {
  const safe = sanitizeFileSegment(input.fileName)
  return `${input.tenantId}/${input.portfolioId}/${input.projectId}/${input.entityType}/${input.entityId}/${input.documentId}-${safe}`
}

export async function presignPutDocument(input: {
  bucket: string
  key: string
  contentType: string
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    ContentType: input.contentType,
  })
  return getSignedUrl(getClient(), cmd, { expiresIn: 3600 })
}

export async function presignGetDocument(input: { bucket: string; key: string }): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
  })
  return getSignedUrl(getClient(), cmd, { expiresIn: 3600 })
}

export async function headObjectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch {
    return false
  }
}
