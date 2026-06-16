import { db, integrationEventMappings, eq, and } from '@/lib/server/db'
import type { EventMappingFilters } from '@/lib/server/db'
import type { IntegrationId } from '@quackback/ids'

const OUTBOUND_TICKET_EVENTS = [
  'ticket.created',
  'ticket.status_changed',
  'ticket.assigned',
  'ticket.updated',
  'ticket.thread_added',
  'ticket.thread_updated',
  'ticket.thread_deleted',
] as const

const LEGACY_POST_EVENTS = ['post.created'] as const

const GITHUB_OUTBOUND_EVENTS = [...OUTBOUND_TICKET_EVENTS, ...LEGACY_POST_EVENTS] as const

function isOutboundGitHubSync(config: Record<string, unknown>): boolean {
  const direction = config.syncDirection ?? 'outbound'
  return direction === 'outbound' || direction === 'bidirectional'
}

function ticketFilters(config: Record<string, unknown>): EventMappingFilters | null {
  return typeof config.defaultInboxId === 'string' && config.defaultInboxId.trim()
    ? { inboxIds: [config.defaultInboxId] }
    : null
}

export async function ensureGitHubEventMappings(args: {
  integrationId: IntegrationId
  config?: Record<string, unknown> | null
}): Promise<boolean> {
  const config = args.config ?? {}
  if (!isOutboundGitHubSync(config)) return false

  const existing = await db.query.integrationEventMappings.findMany({
    where: and(
      eq(integrationEventMappings.integrationId, args.integrationId),
      eq(integrationEventMappings.actionType, 'send_message'),
      eq(integrationEventMappings.targetKey, 'default')
    ),
    columns: { eventType: true },
  })
  const existingEvents = new Set(existing.map((mapping) => mapping.eventType))
  const missingEvents = GITHUB_OUTBOUND_EVENTS.filter((eventType) => !existingEvents.has(eventType))
  if (missingEvents.length === 0) return false

  const filters = ticketFilters(config)
  await db
    .insert(integrationEventMappings)
    .values(
      missingEvents.map((eventType) => ({
        integrationId: args.integrationId,
        eventType,
        actionType: 'send_message' as const,
        filters: OUTBOUND_TICKET_EVENTS.includes(
          eventType as (typeof OUTBOUND_TICKET_EVENTS)[number]
        )
          ? filters
          : null,
        enabled: true,
      }))
    )
    .onConflictDoNothing()

  return true
}
