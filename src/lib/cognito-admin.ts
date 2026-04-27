import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'

export type EnsureCognitoUserInput = {
  email: string
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
  const displayName = input.displayName?.trim()
  const initialPassword = input.initialPassword?.trim()

  const userAttributes = [
    { Name: 'email', Value: email },
    { Name: 'email_verified', Value: 'true' },
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
    return { sub, email }
  }
}
