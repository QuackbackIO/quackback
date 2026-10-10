/**
 * Integration sink resolver (EVENTING-V2 WO-8b) — the DomainEvent-native port of
 * getIntegrationTargets(). Reads the cached integration_event_mappings, applies
 * the board filter, dedupes by (integrationType, channelId), and emits a connection reference
 * per channel. Credentials and current configuration are loaded only at dispatch.
 */
import { db, integrations, integrationEventMappings, eq, and } from '@/lib/server/db'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/cache'
import { logger } from '@/lib/server/logger'
import { getEventDefinition } from '../catalogue'
import { boardIdsFromEvent } from './webhook.resolver'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

const log = logger.child({ component: 'integration-resolver' })

export interface CachedMapping {
  eventType: string
  integrationType: string
  /** Integration row id — lets the worker refresh an expired token by id. */
  integrationId: string
  integrationConfig: unknown
  actionConfig: unknown
  filters: unknown
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
    })
    .from(integrationEventMappings)
    .innerJoin(integrations, eq(integrationEventMappings.integrationId, integrations.id))
    .where(and(eq(integrationEventMappings.enabled, true), eq(integrations.status, 'active')))
  await cacheSet(CACHE_KEYS.INTEGRATION_MAPPINGS, rows, 300)
  return rows
}

/**
 * Pure target construction (unit-testable): filter mappings for this event type,
 * apply the board filter, dedupe by (integrationType, channelId), and retain only the
 * connection reference. Cached credentials never enter queued delivery intents.
 */
export function buildIntegrationTargets(
  mappings: CachedMapping[],
  eventType: string,
  boardIds: string[]
): HookTarget[] {
  const targets: HookTarget[] = []
  const seen = new Set<string>()

  for (const m of mappings) {
    if (m.eventType !== eventType || !m.integrationId) continue

    const filters = m.filters as { boardIds?: string[] } | null
    if (
      filters?.boardIds?.length &&
      boardIds.length > 0 &&
      !boardIds.some((id) => filters.boardIds!.includes(id))
    ) {
      continue
    }

    const integrationConfig = (m.integrationConfig as Record<string, unknown>) || {}
    const actionConfig = (m.actionConfig as Record<string, unknown>) || {}
    const channelId = (actionConfig.channelId || integrationConfig.channelId) as string | undefined
    if (!channelId) {
      log.warn({ integration_type: m.integrationType }, 'no channel id for integration, skipping')
      continue
    }

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
    return buildIntegrationTargets(relevant, event.type, boardIdsFromEvent(event))
  },
}
