/** Single-table: PK = TENANT#{tenantId}, SK según entidad. */

/** Registro global para listar tenants (admin plataforma). */
export const pkPlatformRegistry = () => 'PLATFORM#REGISTRY'

export const skTenantRegistryEntry = (tenantId: string) => `TENANT#${tenantId}`

export const pkTenant = (tenantId: string) => `TENANT#${tenantId}`

export const skTenantMeta = () => 'META#TENANT'

export const skPortfolio = (portfolioId: string) => `PORTFOLIO#${portfolioId}`

export const skProject = (projectId: string) => `PROJECT#${projectId}`

export const skAsset = (assetId: string) => `ASSET#${assetId}`

export const skRevenueFact = (assetId: string, factId: string) => `ASSET#${assetId}#REV#${factId}`

export const skCostFact = (assetId: string, factId: string) => `ASSET#${assetId}#COST#${factId}`

export const skImportJob = (jobId: string) => `IMPORT#${jobId}`

export const skSimulation = (simulationId: string) => `SIMULATION#${simulationId}`

export const skInvestor = (investorId: string) => `INVESTOR#${investorId}`

/** Ledger inmutable por inversionista: SK INV#invId#LEDGER#entryId */
export const skInvestorLedger = (investorId: string, entryId: string) =>
  `INV#${investorId}#LEDGER#${entryId}`

/** Asignación de capital LP a proyecto: un item por (projectId, investorId) */
export const skProjectAllocation = (projectId: string, investorId: string) =>
  `PROJALLOC#${projectId}#${investorId}`

export const skTmsOrder = (orderId: string) => `TMS#ORDER#${orderId}`

export const skTmsTrip = (tripId: string) => `TMS#TRIP#${tripId}`

/** GSI1: listar activos por proyecto */
export const gsi1pkProjectAssets = (tenantId: string, projectId: string) =>
  `TENANT#${tenantId}#PROJECT#${projectId}`

export const gsi1skAsset = (assetId: string) => `ASSET#${assetId}`

/** GSI2: listar activos por tipo */
export const gsi2pkAssetType = (tenantId: string, assetType: string) =>
  `TENANT#${tenantId}#TYPE#${assetType}`

export const gsi2skAsset = (assetId: string) => gsi1skAsset(assetId)
