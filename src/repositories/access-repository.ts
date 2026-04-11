import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { AccessRole, TenantUserProfile } from '../domain/types'
import * as keys from '../lib/keys'
import { accessRolesTableName, getDocumentClient, userProfilesTableName } from './dynamo-client'

const ENTITY = { ACCESS_ROLE: 'ACCESS_ROLE', USER_PROFILE: 'USER_PROFILE' } as const

type RoleItem = Record<string, unknown> & { PK: string; SK: string }

export async function listAccessRoles(tenantId: string): Promise<AccessRole[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: accessRolesTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'ROLE#',
      },
    }),
  )
  return (r.Items ?? [])
    .filter(row => (row as RoleItem).entityType === ENTITY.ACCESS_ROLE)
    .map(row => row as unknown as AccessRole)
}

export async function getAccessRole(tenantId: string, roleId: string): Promise<AccessRole | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: accessRolesTableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skAccessRole(roleId) },
    }),
  )
  if (!r.Item || (r.Item as RoleItem).entityType !== ENTITY.ACCESS_ROLE) return null
  return r.Item as unknown as AccessRole
}

export async function putAccessRole(role: AccessRole): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: accessRolesTableName(),
      Item: {
        PK: keys.pkTenant(role.tenantId),
        SK: keys.skAccessRole(role.id),
        entityType: ENTITY.ACCESS_ROLE,
        ...role,
      },
    }),
  )
}

export async function deleteAccessRole(tenantId: string, roleId: string): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new DeleteCommand({
      TableName: accessRolesTableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skAccessRole(roleId) },
    }),
  )
}

export async function listTenantUserProfiles(tenantId: string): Promise<TenantUserProfile[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: userProfilesTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkTenant(tenantId),
        ':pfx': 'USER#',
      },
    }),
  )
  return (r.Items ?? [])
    .filter(row => (row as RoleItem).entityType === ENTITY.USER_PROFILE)
    .map(row => row as unknown as TenantUserProfile)
}

export async function getTenantUserProfile(tenantId: string, cognitoSub: string): Promise<TenantUserProfile | null> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new GetCommand({
      TableName: userProfilesTableName(),
      Key: { PK: keys.pkTenant(tenantId), SK: keys.skUserProfile(cognitoSub) },
    }),
  )
  if (!r.Item || (r.Item as RoleItem).entityType !== ENTITY.USER_PROFILE) return null
  return r.Item as unknown as TenantUserProfile
}

export async function putTenantUserProfile(profile: TenantUserProfile): Promise<void> {
  const ddb = getDocumentClient()
  await ddb.send(
    new PutCommand({
      TableName: userProfilesTableName(),
      Item: {
        PK: keys.pkTenant(profile.tenantId),
        SK: keys.skUserProfile(profile.cognitoSub),
        entityType: ENTITY.USER_PROFILE,
        ...profile,
      },
    }),
  )
}
