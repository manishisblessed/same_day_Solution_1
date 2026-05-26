import fs from 'fs/promises'
import path from 'path'
import type { LegalDocumentContent, LegalDocumentMeta, LegalManifest } from './types'

const LEGAL_VERSION = 'v1.0'

function getLegalRoot() {
  return path.join(process.cwd(), 'legal', LEGAL_VERSION)
}

export function getLegalVersion() {
  return LEGAL_VERSION
}

export async function loadLegalManifest(): Promise<LegalManifest> {
  const manifestPath = path.join(getLegalRoot(), 'manifest.json')
  const raw = await fs.readFile(manifestPath, 'utf-8')
  return JSON.parse(raw) as LegalManifest
}

export async function listLegalDocuments(): Promise<LegalDocumentMeta[]> {
  const manifest = await loadLegalManifest()
  return [...manifest.documents].sort((a, b) => a.order - b.order)
}

export async function getLegalDocument(docId: string): Promise<LegalDocumentContent | null> {
  const manifest = await loadLegalManifest()
  const meta = manifest.documents.find((doc) => doc.id === docId)
  if (!meta) return null

  const filePath = path.join(getLegalRoot(), meta.fileName)
  const content = await fs.readFile(filePath, 'utf-8')

  return {
    ...meta,
    content,
    version: manifest.version,
    effectiveDate: manifest.effectiveDate,
  }
}

export async function getAllLegalDocumentsContent(): Promise<LegalDocumentContent[]> {
  const manifest = await loadLegalManifest()
  const sorted = [...manifest.documents].sort((a, b) => a.order - b.order)
  const results = await Promise.all(
    sorted.map(async (meta) => {
      const filePath = path.join(getLegalRoot(), meta.fileName)
      const content = await fs.readFile(filePath, 'utf-8')
      return {
        ...meta,
        content,
        version: manifest.version,
        effectiveDate: manifest.effectiveDate,
      }
    })
  )
  return results
}
