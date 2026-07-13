/**
 * Integration sink resolver (EVENTING-V2 WO-8b) — the DomainEvent-native port of
 * getIntegrationTargets(). Reads the cached integration_event_mappings, applies
 * the board filter, dedupes by (integrationType, channelId), decrypts the
 * per-integration access token, and emits one target per channel. Behavior +
 * target shape are preserved; only the event access (payload vs data) changes.
 */
import { db, integrations, integrationEventMappings, eq, and } from '@/lib/server/db'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/redis'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { buildHookContext } from '../hook-context'
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
  secrets: string | null
  integrationConfig: unknown
  actionConfig: unknown
  filters: unknown
}

async function loadMappings(): Promise<CachedMapping[]> {
  const cached = await cacheGet<CachedMapping[]>(CACHE_KEYS.INTEGRATION_MAPPINGS)
  if (cached) return cached
  const rows = await db
    .select({
      eventType: integrationEventMappings.eventType,
      integrationType: integrations.integrationType,
      secrets: integrations.secrets,
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
 * apply the board filter, dedupe by (integrationType, channelId), decrypt the
 * token via the injected `decrypt`. Mirrors getIntegrationTargets exactly.
 */
export function buildIntegrationTargets(
  mappings: CachedMapping[],
  eventType: string,
  boardIds: string[],
  rootUrl: string,
  decrypt: (blob: string) => { accessToken?: string }
): HookTarget[] {
  const targets: HookTarget[] = []
  const seen = new Set<string>()

  for (const m of mappings) {
    if (m.eventType !== eventType) continue

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

    let accessToken: string | undefined
    if (m.secrets) {
      try {
        accessToken = decrypt(m.secrets).accessToken
      } catch (error) {
        log.error(
          { err: error, integration_type: m.integrationType },
          'failed to decrypt integration secrets'
        )
        continue
      }
    }

    targets.push({
      type: m.integrationType,
      target: { channelId },
      config: { accessToken, rootUrl },
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
    const context = await buildHookContext()
    if (!context) throw new Error('Failed to build integration hook context')
    return buildIntegrationTargets(
      relevant,
      event.type,
      boardIdsFromEvent(event),
      context.portalBaseUrl,
      (blob) => decryptSecrets<{ accessToken?: string }>(blob)
    )
  },
}
