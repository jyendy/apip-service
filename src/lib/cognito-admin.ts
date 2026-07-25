import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'

/** Atributo real del User Pool actual (schema CFN con Name: custom:tenantId → custom:custom:tenantId). */
const COGNITO_TENANT_ATTR = 'custom:custom:tenantId'

export type EnsureCognitoUserInput = {
  email: string
  /** Se persiste en Cognito como `custom:custom:tenantId` para el ID token. */
  tenantId: string
  displayName?: string
  /** Contraseña temporal en Cognito; si existe, no se envía invitación por correo (MessageAction SUPPRESS). */
  initialPassword?: string
}

const cognito = new CognitoIdentityProviderClient({})

function userPoolId(): string {
  const value = process.env.COGNITO_USER_POOL_ID?.trim()
  if (!value) throw new Error('Falta configurar COGNITO_USER_POOL_ID')
  return value
}

function readAttribute(user: UserType | undefined, key: string): string | undefined {
  return user?.Attributes?.find(a => a.Name === key)?.Value
}

async function setCognitoTenantClaim(poolId: string, username: string, tenantId: string): Promise<void> {
  const tid = tenantId.trim()
  if (!tid) throw new Error(`tenantId vacío para ${COGNITO_TENANT_ATTR}`)
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: poolId,
      Username: username,
      UserAttributes: [{ Name: COGNITO_TENANT_ATTR, Value: tid }],
    }),
  )
}

async function getUserByEmail(poolId: string, email: string): Promise<UserType | undefined> {
  const response = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: poolId,
      Username: email,
    }),
  )
  return {
    Username: response.Username,
    Attributes: response.UserAttributes,
    Enabled: response.Enabled,
    UserStatus: response.UserStatus,
    UserCreateDate: response.UserCreateDate,
    UserLastModifiedDate: response.UserLastModifiedDate,
  }
}

export async function ensureCognitoUser(input: EnsureCognitoUserInput): Promise<{ sub: string; email: string }> {
  const poolId = userPoolId()
  const email = input.email.trim().toLowerCase()
  if (!email) throw new Error('Email inválido para crear usuario en Cognito')
  const tenantId = input.tenantId.trim()
  if (!tenantId) throw new Error('tenantId requerido para crear o asegurar usuario en Cognito')
  const displayName = input.displayName?.trim()
  const initialPassword = input.initialPassword?.trim()

  const userAttributes = [
    { Name: 'email', Value: email },
    { Name: 'email_verified', Value: 'true' },
    { Name: COGNITO_TENANT_ATTR, Value: tenantId },
    ...(displayName ? [{ Name: 'name', Value: displayName }] : []),
  ]

  try {
    const created = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email,
        ...(initialPassword
          ? {
              MessageAction: 'SUPPRESS' as const,
              TemporaryPassword: initialPassword,
            }
          : { DesiredDeliveryMediums: ['EMAIL' as const] }),
        UserAttributes: userAttributes,
      }),
    )
    const sub = readAttribute(created.User, 'sub')
    if (!sub) throw new Error('Cognito no devolvió claim sub al crear usuario')
    return { sub, email }
  } catch (error) {
    const e = error as { name?: string }
    if (e?.name === 'InvalidPasswordException') {
      throw new Error(
        'La contraseña inicial no cumple la política del user pool de Cognito (longitud y complejidad).',
      )
    }
    if (e?.name !== 'UsernameExistsException') throw error
    const existing = await getUserByEmail(poolId, email)
    const sub = readAttribute(existing, 'sub')
    if (!sub) throw new Error('Usuario ya existe en Cognito pero no se pudo resolver sub')
    await setCognitoTenantClaim(poolId, email, tenantId)
    return { sub, email }
  }
}

/**
 * Asigna contraseña en Cognito (admin). Prueba `username` email y luego `cognitoSub` por si el pool usa uno u otro.
 */
export async function setCognitoUserPassword(input: {
  email?: string
  cognitoSub: string
  password: string
  /** Por defecto true: el usuario puede entrar sin flujo FORCE_CHANGE_PASSWORD. */
  permanent?: boolean
}): Promise<void> {
  const poolId = userPoolId()
  const pwd = input.password
  const permanent = input.permanent ?? true
  const candidates: string[] = []
  const em = input.email?.trim()
  if (em) candidates.push(em)
  const sub = input.cognitoSub.trim()
  if (sub && !candidates.includes(sub)) candidates.push(sub)

  let last: unknown
  for (const username of candidates) {
    if (!username) continue
    try {
      await cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: poolId,
          Username: username,
          Password: pwd,
          Permanent: permanent,
        }),
      )
      return
    } catch (error) {
      last = error
      const name = (error as { name?: string }).name
      if (name === 'UserNotFoundException') continue
      if (name === 'InvalidPasswordException') {
        throw new Error(
          'La contraseña no cumple la política del user pool de Cognito (longitud y complejidad).',
        )
      }
      throw error
    }
  }
  throw last instanceof Error ? last : new Error('No se pudo asignar contraseña en Cognito (usuario no encontrado).')
}
