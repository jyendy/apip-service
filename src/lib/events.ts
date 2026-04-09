import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'

const client = new EventBridgeClient({})

export type DomainEventDetail = {
  tenantId: string
  type: string
  correlationId?: string
  payload: Record<string, unknown>
}

export async function publishDomainEvent(
  eventBusName: string | undefined,
  source: string,
  detail: DomainEventDetail,
): Promise<void> {
  if (!eventBusName) return
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: eventBusName,
          Source: source,
          DetailType: detail.type,
          Detail: JSON.stringify(detail),
        },
      ],
    }),
  )
}
