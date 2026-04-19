import type { Document, DocumentRequirement } from '../domain/types'

function docMatchesRequirement(doc: Document, req: DocumentRequirement): boolean {
  if (doc.requirementId && doc.requirementId === req.id) return true
  if (!doc.requirementId && doc.name.trim().toLowerCase() === req.name.trim().toLowerCase()) return true
  return false
}

function isSatisfiedForRequirement(doc: Document): boolean {
  return doc.status === 'uploaded' || doc.status === 'validated'
}

/**
 * Requisitos obligatorios sin documento aceptable (subido o validado; pendiente o rechazado no cubre).
 */
export function computeMissingRequiredDocuments(
  requirements: DocumentRequirement[],
  documents: Document[],
): string[] {
  const missing: string[] = []
  for (const req of requirements) {
    if (!req.required) continue
    const ok = documents.some(d => docMatchesRequirement(d, req) && isSatisfiedForRequirement(d))
    if (!ok) missing.push(req.name)
  }
  return missing
}
