/**
 * Integration sink resolver (EVENTING-V2 WO-8b) — the DomainEvent-native port of
 * getIntegrationTargets(). Reads the cached integration_event_mappings, applies
 * the board and ticket filters, dedupes by (integrationType, channelId), and emits a connection reference
 * per channel. Credentials and current configuration are loaded only at dispatch.
 *
 * LOOP-SAFETY: an integration is never sent what its own service principal
 * did. Inbound sync (an issue opening a ticket, a status or assignee arriving
 * from the platform) runs as that principal, so the events it causes go
 * nowhere back to the integration they came from; other integrations still
 * hear them. A ticket's issue create applies it again against the current
 * connection when it is queued (`queueTicketIssueSync`).
 */
import {
  db,
  integrations,
  integrationEventMappings,
  integrationDestinations,
  eq,
  and,
  sql,
} from '@/lib/server/db'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/cache'
import { logger } from '@/lib/server/logger'
import { getEventDefinition } from '../catalogue'
import { boardIdsFromEvent } from './webhook.resolver'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'
import type { EventMappingFilters } from '@/lib/server/db'
import {
  hasTicketFilters,
  ticketMatchesFilters,
  type TicketScopeFacts,
} from '@/lib/server/integrations/ticket-issues'

const log = logger.child({ component: 'integration-resolver' })

export interface CachedMapping {
  eventType: string
  integrationType: string
  /** Integration row id — lets the worker refresh an expired token by id. */
  integrationId: string
  integrationConfig: unknown
  actionConfig: unknown
  filters: unknown
  /**
   * Names (lower-cased) of the connection's destinations that take nothing
   * outbound: switched off or inbound-only. A mapping routed to one of them
   * is skipped. Absent from mappings cached before destinations existed; the
   * worker re-checks the destination before sending anyway.
   */
  closedDestinations?: string[]
  /**
   * The integration's service principal, which its inbound sync acts as (the
   * loop rule's key). Absent from mappings cached before it was recorded;
   * queueing a ticket's issue applies the rule again regardless.
   */
  integrationPrincipalId?: string | null
}

/** What the filters and the loop rule read off one event. */
export interface IntegrationEventContext {
  /** Who caused it, as the envelope records them. */
  actor?: { type: string; id?: string }
  /** The ticket a ticket event is about: its team and type as of the event. */
  ticket?: TicketScopeFacts
}

async function loadMappings(): Promise<CachedMapping[]> {
  const cached = await cacheGet<CachedMapping[]>(CACHE_KEYS.INTEGRATION_MAPPINGS)
  if (cached?.every((mapping) => typeof mapping.integrationId === 'string')) return cached
  const rows = await db
    .select({
      eventType: integrationEventMappings.eventType,
      integrationType: integrations.integrationType,
      integrationId: integrations.id,
      integrationConfig: integrations.config,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
      integrationPrincipalId: integrations.principalId,
      closedDestinations: sql<string[]>`coalesce((
        SELECT array_agg(lower(${integrationDestinations.externalId}))
        FROM ${integrationDestinations}
        WHERE ${integrationDestinations.integrationId} = ${integrations.id}
          AND (${integrationDestinations.enabled} = false
            OR ${integrationDestinations.config}->>'direction' = 'inbound')
      ), '{}')`,
    })
    .from(integrationEventMappings)
    .innerJoin(integrations, eq(integrationEventMappings.integrationId, integrations.id))
    .where(and(eq(integrationEventMappings.enabled, true), eq(integrations.status, 'active')))
  await cacheSet(CACHE_KEYS.INTEGRATION_MAPPINGS, rows, 300)
  return rows
}

/**
 * Pure target construction (unit-testable): filter mappings for this event type,
 * apply the board and ticket filters and the loop rule, dedupe by
 * (integrationType, channelId), and retain only the connection reference.
 * Cached credentials never enter queued delivery intents.
 */
export function buildIntegrationTargets(
  mappings: CachedMapping[],
  eventType: string,
  boardIds: string[],
  context: IntegrationEventContext = {}
): HookTarget[] {
  const targets: HookTarget[] = []
  const seen = new Set<string>()

  for (const m of mappings) {
    if (m.eventType !== eventType || !m.integrationId) continue
    if (
      context.actor?.type === 'service' &&
      context.actor.id &&
      m.integrationPrincipalId === context.actor.id
    )
      continue

    const filters = m.filters as EventMappingFilters | null
    if (
      filters?.boardIds?.length &&
      boardIds.length > 0 &&
      !boardIds.some((id) => filters.boardIds!.includes(id))
    ) {
      continue
    }
    if (
      hasTicketFilters(filters) &&
      !(context.ticket && ticketMatchesFilters(filters, context.ticket))
    )
      continue

    const integrationConfig = (m.integrationConfig as Record<string, unknown>) || {}
    const actionConfig = (m.actionConfig as Record<string, unknown>) || {}
    const channelId = (actionConfig.channelId || integrationConfig.channelId) as string | undefined
    if (!channelId) {
      log.warn({ integration_type: m.integrationType }, 'no channel id for integration, skipping')
      continue
    }

    if (m.closedDestinations?.includes(channelId.toLowerCase())) continue

    const dedupeKey = `${m.integrationType}:${channelId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    targets.push({
      type: m.integrationType,
      target: { channelId },
      config: { integrationId: m.integrationId },
    })
  }

  return targets
}

/**
 * The team and type a ticket event names. `ticket.assigned` carries the new
 * team beside the ticket reference; every other ticket event's reference has it.
 */
function ticketFromEvent(event: DomainEvent): TicketScopeFacts | undefined {
  if (event.entityType !== 'ticket') return undefined
  const payload = event.payload as {
    ticket?: { assignedTeamId?: string | null; ticketTypeId?: string | null }
    assignedTeamId?: string | null
  }
  if (!payload.ticket) return undefined
  return {
    teamId: 'assignedTeamId' in payload ? payload.assignedTeamId : payload.ticket.assignedTeamId,
    ticketTypeId: payload.ticket.ticketTypeId,
  }
}

/** Private comments never reach external integrations. */
function isPrivateComment(event: DomainEvent): boolean {
  if (
    event.type !== 'comment.created' &&
    event.type !== 'comment.updated' &&
    event.type !== 'comment.deleted'
  ) {
    return false
  }
  return (event.payload as { comment?: { isPrivate?: boolean } }).comment?.isPrivate === true
}

export const integrationResolver: SinkResolver = {
  sink: 'integration',
  // Any type with at least one active mapping is interesting. The cheap
  // pre-filter can't know mappings without a query, so accept all types; the
  // mapping filter in resolve() is the real gate (mirrors the monolith, which
  // also queried unconditionally). Private-comment types short-circuit below.
  interestedIn(type: string): boolean {
    return getEventDefinition(type) !== undefined
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    if (isPrivateComment(event)) return []
    const mappings = await loadMappings()
    const relevant = mappings.filter((m) => m.eventType === event.type)
    if (relevant.length === 0) return []
    return buildIntegrationTargets(relevant, event.type, boardIdsFromEvent(event), {
      actor: { type: event.actorType, id: event.actorId },
      ticket: ticketFromEvent(event),
    })
  },
}
