export type PartnerRole = 'retailer' | 'distributor' | 'master_distributor' | 'partner'

export interface LegalManifestCompany {
  legalName: string
  registeredOffice: string
  cin: string
  pan: string
  gstin: string
  email: string
  website: string
  grievanceOfficer: {
    name: string
    email: string
    phone: string
  }
}

export interface LegalDocumentMeta {
  id: string
  fileName: string
  title: string
  shortTitle: string
  description: string
  roles: PartnerRole[]
  requiredForOnboarding: boolean
  order: number
}

export interface LegalManifest {
  version: string
  effectiveDate: string
  company: LegalManifestCompany
  governingLaw: string
  jurisdiction: string
  arbitrationSeat: string
  documents: LegalDocumentMeta[]
}

export interface LegalDocumentContent extends LegalDocumentMeta {
  content: string
  version: string
  effectiveDate: string
}
