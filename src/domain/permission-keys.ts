/**
 * Catálogo de claves de permiso (extensible). Los roles almacenan subconjuntos de estas claves.
 * Convención: recurso:ámbito (p. ej. assets:read, investors:read).
 */
export const PERMISSION_KEYS = [
  'platform:admin',
  'access:manage',
  'assets:read',
  'assets:write',
  'portfolios:read',
  'portfolios:write',
  'projects:read',
  'projects:write',
  'investors:read',
  'investors:write',
  'reports:read',
  'tms:read',
  'tms:write',
  'simulations:read',
  'simulations:write',
  'imports:write',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]
