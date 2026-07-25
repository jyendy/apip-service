/** Single-table: PK = TENANT#{tenantId}, SK según entidad. */

/** Registro global para listar tenants (admin plataforma). */
export const pkPlatformRegistry = () => 'PLATFORM#REGISTRY'

/** Catálogo global de reglas de insights financieros (motor decisional). */
export const pkPlatformInsightRules = () => 'PLATFORM#INSIGHT_RULES'

export const skInsightRule = (ruleId: string) => `INSIGHT_RULE#${ruleId}`

export const skTenantRegistryEntry = (tenantId: string) => `TENANT#${tenantId}`

/** Solicitudes de alta (onboarding) a nivel plataforma, ordenables por fecha. */
export const skOnboardingRequest = (createdAt: string, requestId: string) =>
  `ONBOARDING#${createdAt}#${requestId}`

/** Índice por email para dedupe/lookup rápido (solicitudes de alta). */
export const pkOnboardingByEmail = (email: string) => `PLATFORM#ONBOARDING_EMAIL#${email.toLowerCase()}`
export const skOnboardingByEmail = (createdAt: string, requestId: string) => `REQ#${createdAt}#${requestId}`

/** Rate limit simple para endpoints públicos (TTL). */
export const pkPlatformRateLimit = () => 'PLATFORM#RATE_LIMIT'
export const skOnboardingRateLimit = (kind: 'ip' | 'email', key: string) => `ONBOARDING#${kind}#${key}`

export const pkTenant = (tenantId: string) => `TENANT#${tenantId}`

export const skTenantMeta = () => 'META#TENANT'

export const skPortfolio = (portfolioId: string) => `PORTFOLIO#${portfolioId}`

export const skProject = (projectId: string) => `PROJECT#${projectId}`

export const skScenario = (scenarioId: string) => `SCENARIO#${scenarioId}`

export const skAsset = (assetId: string) => `ASSET#${assetId}`

export const skRevenueFact = (assetId: string, factId: string) => `ASSET#${assetId}#REV#${factId}`

export const skCostFact = (assetId: string, factId: string) => `ASSET#${assetId}#COST#${factId}`

export const skCapitalContribution = (assetId: string, contributionId: string) =>
  `ASSET#${assetId}#CAPITAL#${contributionId}`

export const skOccupancyRecord = (assetId: string, month: string, recordId: string) =>
  `ASSET#${assetId}#OCC#${month}#${recordId}`

/** Un financiamiento por activo (MVP): un solo ítem bajo el tenant. */
export const skAssetFinancing = (assetId: string) => `ASSET#${assetId}#FINANCING`

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

export const skTmsCustomer = (customerId: string) => `TMS#CUSTOMER#${customerId}`

export const skTmsLocality = (localityId: string) => `TMS#LOCALITY#${localityId}`

export const skTmsProvider = (providerId: string) => `TMS#PROVIDER#${providerId}`

export const skTmsDriver = (driverId: string) => `TMS#DRIVER#${driverId}`

export const skTmsVehicleUnit = (vehicleUnitId: string) => `TMS#VEHICLE#${vehicleUnitId}`

export const skTmsRate = (rateId: string) => `TMS#RATE#${rateId}`

export const skTmsRoute = (routeId: string) => `TMS#ROUTE#${routeId}`

export const skAccessRole = (roleId: string) => `ROLE#${roleId}`

export const skUserProfile = (cognitoSub: string) => `USER#${cognitoSub}`

/** GSI1: listar activos por proyecto */
export const gsi1pkProjectAssets = (tenantId: string, projectId: string) =>
  `TENANT#${tenantId}#PROJECT#${projectId}`

export const gsi1skAsset = (assetId: string) => `ASSET#${assetId}`

/** GSI4: listar escenarios por proyecto */
export const gsi4pkScenariosByProject = (tenantId: string, projectId: string) =>
  `TENANT#${tenantId}#PROJECT#${projectId}`

export const gsi4skScenario = (scenarioId: string) => `SCENARIO#${scenarioId}`

/** GSI2: listar activos por tipo */
export const gsi2pkAssetType = (tenantId: string, assetType: string) =>
  `TENANT#${tenantId}#TYPE#${assetType}`

export const gsi2skAsset = (assetId: string) => gsi1skAsset(assetId)

/** GSI3: listar documentos por entidad (tenant + tipo + id). */
export const gsi3pkDocumentEntity = (tenantId: string, entityType: string, entityId: string) =>
  `TENANT#${tenantId}#DOC_ENTITY#${entityType}#${entityId}`

export const gsi3skDocument = (documentId: string) => `DOC#${documentId}`

export const skFlipProject = (assetId: string) => `FLIP#PROJECT#${assetId}`

export const skFlipDueDiligenceItem = (assetId: string, itemId: string) => `FLIP#DD#${assetId}#${itemId}`

export const skFlipRehab = (assetId: string, rehabId: string) => `FLIP#REHAB#${assetId}#${rehabId}`

export const skVendor = (vendorId: string) => `VENDOR#${vendorId}`

export const skDocument = (documentId: string) => `DOC#${documentId}`

/** Plantillas de documentos requeridos por tipo de entidad. */
export const skDocRequirement = (entityType: string, requirementId: string) =>
  `DOCREQ#${entityType}#${requirementId}`
