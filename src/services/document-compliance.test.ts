import { describe, expect, it } from 'vitest'
import { computeMissingRequiredDocuments } from './document-compliance'
import type { Document, DocumentRequirement } from '../domain/types'

const baseReq = (over: Partial<DocumentRequirement>): DocumentRequirement => ({
  id: 'dreq_1',
  tenantId: 'ten_x',
  entityType: 'asset',
  name: 'Contrato',
  required: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const baseDoc = (over: Partial<Document>): Document => ({
  id: 'doc_1',
  tenantId: 'ten_x',
  portfolioId: 'prt_x',
  projectId: 'prj_x',
  entityType: 'asset',
  entityId: 'ast_x',
  name: 'Contrato',
  fileName: 'c.pdf',
  mimeType: 'application/pdf',
  size: 1,
  s3Key: 'k',
  status: 'uploaded',
  required: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

describe('computeMissingRequiredDocuments', () => {
  it('marca faltante cuando no hay documento satisfactorio', () => {
    const reqs = [baseReq({ id: 'r1', name: 'ID fiscal', required: true })]
    const docs: Document[] = []
    expect(computeMissingRequiredDocuments(reqs, docs)).toEqual(['ID fiscal'])
  })

  it('no exige requisitos opcionales', () => {
    const reqs = [baseReq({ name: 'Extra', required: false })]
    expect(computeMissingRequiredDocuments(reqs, [])).toEqual([])
  })

  it('cubre por requirementId', () => {
    const reqs = [baseReq({ id: 'r1', name: 'Póliza', required: true })]
    const docs = [baseDoc({ requirementId: 'r1', status: 'uploaded' })]
    expect(computeMissingRequiredDocuments(reqs, docs)).toEqual([])
  })

  it('rechazado no cubre requisito', () => {
    const reqs = [baseReq({ id: 'r1', name: 'KYC', required: true })]
    const docs = [baseDoc({ requirementId: 'r1', status: 'rejected' })]
    expect(computeMissingRequiredDocuments(reqs, docs)).toEqual(['KYC'])
  })
})
