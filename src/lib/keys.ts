/** Single-table: PK = TENANT#{tenantId}, SK según entidad. */

export const pkTenant = (tenantId: string) => `TENANT#${tenantId}`

export const skTenantMeta = () => 'META#TENANT'

export const skPortfolio = (portfolioId: string) => `PORTFOLIO#${portfolioId}`

export const skProject = (projectId: string) => `PROJECT#${projectId}`

export const skAsset = (assetId: string) => `ASSET#${assetId}`

export const skRevenueFact = (assetId: string, factId: string) => `ASSET#${assetId}#REV#${factId}`

export const skCostFact = (assetId: string, factId: string) => `ASSET#${assetId}#COST#${factId}`

export const skImportJob = (jobId: string) => `IMPORT#${jobId}`

/** GSI1: listar activos por proyecto */
export const gsi1pkProjectAssets = (tenantId: string, projectId: string) =>
  `TENANT#${tenantId}#PROJECT#${projectId}`

export const gsi1skAsset = (assetId: string) => `ASSET#${assetId}`

/** GSI2: listar activos por tipo */
export const gsi2pkAssetType = (tenantId: string, assetType: string) =>
  `TENANT#${tenantId}#TYPE#${assetType}`

export const gsi2skAsset = (assetId: string) => gsi1skAsset(assetId)
