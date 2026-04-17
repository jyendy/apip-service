import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { InsightRule } from '../domain/types'
import { defaultPlatformInsightRules } from '../data/financial-insight-rules-defaults'
import * as keys from '../lib/keys'
import { getDocumentClient, tableName } from './dynamo-client'

const ENTITY = 'INSIGHT_RULE'

type DdbInsightRuleItem = InsightRule & {
  PK: string
  SK: string
  entityType: typeof ENTITY
}

function toRule(item: Record<string, unknown>): InsightRule | null {
  if (item.entityType !== ENTITY) return null
  const id = item.id
  if (typeof id !== 'string') return null
  return {
    id,
    name: String(item.name ?? ''),
    description: item.description !== undefined ? String(item.description) : undefined,
    severity: item.severity as InsightRule['severity'],
    scope: item.scope as InsightRule['scope'],
    condition: String(item.condition ?? ''),
    message: String(item.message ?? ''),
    recommendation: item.recommendation !== undefined ? String(item.recommendation) : undefined,
    priority: Number(item.priority ?? 0),
    isActive: Boolean(item.isActive),
    createdAt: String(item.createdAt ?? ''),
  }
}

export async function listPlatformInsightRules(): Promise<InsightRule[]> {
  const ddb = getDocumentClient()
  const r = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': keys.pkPlatformInsightRules(),
        ':pfx': 'INSIGHT_RULE#',
      },
    }),
  )
  const rows = (r.Items ?? []) as Record<string, unknown>[]
  const rules = rows.map(toRule).filter((x): x is InsightRule => x !== null)
  return rules.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

let seeding: Promise<void> | null = null

/** Si el catálogo global está vacío, inserta las reglas por defecto (una sola vez; concurrente comparte la misma promesa). */
export async function ensurePlatformInsightRulesSeeded(): Promise<void> {
  if (seeding) return seeding
  const run = (async () => {
    const existing = await listPlatformInsightRules()
    if (existing.length > 0) return
    const defaults = defaultPlatformInsightRules()
    const ddb = getDocumentClient()
    const requests = defaults.map(rule => ({
      PutRequest: {
        Item: itemFromRule(rule) as Record<string, unknown>,
      },
    }))
    for (let i = 0; i < requests.length; i += 25) {
      const chunk = requests.slice(i, i + 25)
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName()]: chunk,
          },
        }),
      )
    }
  })()
  seeding = run
  try {
    await run
  } finally {
    seeding = null
  }
}

function itemFromRule(rule: InsightRule): DdbInsightRuleItem {
  return {
    PK: keys.pkPlatformInsightRules(),
    SK: keys.skInsightRule(rule.id),
    entityType: ENTITY,
    ...rule,
  }
}

/**
 * Reglas aplicables al tenant: catálogo global (y en el futuro overrides por tenant).
 */
export async function listInsightRulesForTenant(_tenantId: string): Promise<InsightRule[]> {
  await ensurePlatformInsightRulesSeeded()
  return listPlatformInsightRules()
}
