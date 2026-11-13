/**
 * Managing the destinations one connection serves: adding a repository,
 * removing it, switching it off and changing its settings. The building blocks
 * (lookup, webhooks, config scoping) live in `destinations.ts`; this file is
 * the workflow around them, called by the integration-destination server
 * functions.
 *
 * The connection's `config.channelId` stays the default destination: the one
 * the original feedback-to-issue mapping (target key `default`) creates in,
 * and the one ticket issues go to when nobody picks. Every other destination
 * mirrors that mapping with its own row (target key = the destination's id),
 * so turning "create an issue from new feedback" on or off applies to all of
 * them, and a destination never gets a mapping the connection did not ask for.
 * The one exception is a destination's own ticket opt-in (see
 * `ticket-issues.ts`): its mappings are set per destination, with that
 * destination's filters, and mirroring leaves them alone.
 */
import {
  isTypeId,
  type IntegrationDestinationId,
  type IntegrationId,
  type TeamId,
  type TicketTypeId,
} from '@quackback/ids'
import {
  db,
  eq,
  and,
  sql,
  inArray,
  notInArray,
  isNull,
  integrations,
  integrationDestinations,
  integrationEventMappings,
  postExternalLinks,
  teams,
  ticketTypes,
} from '@/lib/server/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isUniqueViolation } from '@/lib/server/utils'
import { logger } from '@/lib/server/logger'
import { getIntegration } from './index'
import { withIntegrationReadAuth, getIntegrationAuth } from './token-refresh'
import { recordIntegrationLastError } from './webhook-registration'
import { syncScopeFor } from './sync/identity'
import { TICKET_ISSUE_EVENTS, isTicketIssueEvent } from './ticket-issues'
import {
  destinationConfig,
  destinationTarget,
  ensureDestinations,
  findDestination,
  listDestinations,
  recordDestinationError,
  registerDestinationWebhook,
  unregisterDestinationWebhook,
  type IntegrationDestination,
} from './destinations'

const log = logger.child({ component: 'integration-destination-admin' })

type IntegrationRow = typeof integrations.$inferSelect

async function clearMappingCache(): Promise<void> {
  const { cacheDel, CACHE_KEYS } = await import('@/lib/server/cache')
  await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
}

/** The provider's several-destinations capability, or a refusal for one without it. */
function multipleOf(integrationType: string) {
  const multiple = getIntegration(integrationType)?.destination?.multiple
  if (!multiple)
    throw new ValidationError(
      'NOT_SUPPORTED',
      'This integration does not sync more than one destination'
    )
  return multiple
}

function isDefault(integration: Pick<IntegrationRow, 'config'>, externalId: string): boolean {
  const channelId = (integration.config as Record<string, unknown> | null)?.channelId
  return typeof channelId === 'string' && channelId.toLowerCase() === externalId.toLowerCase()
}

/** A destination and the connection it belongs to, or 404. */
async function loadDestination(destinationId: string) {
  const destination = await db.query.integrationDestinations.findFirst({
    where: eq(integrationDestinations.id, destinationId as IntegrationDestinationId),
  })
  const integration = destination
    ? await db.query.integrations.findFirst({
        where: eq(integrations.id, destination.integrationId),
      })
    : undefined
  if (!destination || !integration)
    throw new NotFoundError('DESTINATION_NOT_FOUND', 'Destination not found')
  return { destination, integration }
}

/**
 * Give every non-default destination the connection's default event mappings
 * (target key `default`, which route to `config.channelId`), each routed to
 * that destination, with the same filters. A default mapping that is off or
 * missing means the destinations get none, and a mapping left over for a
 * destination that is now the default (or gone) is removed.
 */
export async function mirrorDestinationEventMappings(integrationId: IntegrationId): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, integrationId),
    with: { eventMappings: true },
  })
  if (!integration) return
  const multiple = getIntegration(integration.integrationType)?.destination?.multiple
  if (!multiple) return
  const destinations = await listDestinations(integrationId, multiple.kind)
  const mirrored = destinations.filter((d) => !isDefault(integration, d.externalId))
  const defaults = integration.eventMappings.filter(
    (m) => m.targetKey === 'default' && m.enabled && !isTicketIssueEvent(m.eventType)
  )

  await db.transaction(async (tx) => {
    const allIds = destinations.map((d) => d.id as string)
    const keep = defaults.length ? mirrored.map((d) => d.id as string) : []
    const stale = allIds.filter((id) => !keep.includes(id))
    if (stale.length)
      await tx
        .delete(integrationEventMappings)
        .where(
          and(
            eq(integrationEventMappings.integrationId, integrationId),
            inArray(integrationEventMappings.targetKey, stale),
            notInArray(integrationEventMappings.eventType, [...TICKET_ISSUE_EVENTS])
          )
        )
    const rows = defaults.flatMap((mapping) =>
      mirrored.map((destination) => ({
        integrationId,
        eventType: mapping.eventType,
        actionType: mapping.actionType,
        targetKey: destination.id as string,
        actionConfig: { ...mapping.actionConfig, channelId: destination.externalId },
        filters: mapping.filters,
        enabled: true,
      }))
    )
    if (rows.length)
      await tx
        .insert(integrationEventMappings)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            integrationEventMappings.integrationId,
            integrationEventMappings.eventType,
            integrationEventMappings.actionType,
            integrationEventMappings.targetKey,
          ],
          set: {
            enabled: true,
            actionConfig: sql`excluded.action_config`,
            filters: sql`excluded.filters`,
            updatedAt: new Date(),
          },
        })
  })
}

/**
 * Start syncing one more destination (a GitHub repository). It must be one
 * the connection can see in the provider's own listing, which also supplies
 * its immutable key. A destination already synced is refused. The first one
 * becomes the default. Its webhook is registered when something listens to
 * webhooks; a registration failure is recorded on it for a repair, and does
 * not undo the add.
 */
export async function addDestination(input: {
  integrationType: string
  kind: string
  externalId: string
}): Promise<IntegrationDestination> {
  const multiple = multipleOf(input.integrationType)
  const lister = getIntegration(input.integrationType)?.destinations?.[input.kind]
  if (multiple.kind !== input.kind || !lister)
    throw new ValidationError('NOT_SUPPORTED', 'This integration does not sync that kind')
  const noun = multiple.label.toLowerCase()
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.integrationType, input.integrationType),
  })
  if (!integration?.secrets || integration.status !== 'active')
    throw new ValidationError('INTEGRATION_UNAVAILABLE', 'Connect the integration first')

  await ensureDestinations(integration)
  const wanted = input.externalId.trim().toLowerCase()
  const items = await withIntegrationReadAuth(integration.id, ({ accessToken, config }) =>
    accessToken ? lister.list({ accessToken, config }) : Promise.resolve([])
  )
  const item = items.find((candidate) => candidate.id.toLowerCase() === wanted)
  if (!item)
    throw new ValidationError('INVALID_DESTINATION', `Choose a ${noun} this connection can access`)

  const duplicate =
    (await findDestination(integration.id, input.kind, { externalId: item.id })) ??
    (item.key ? await findDestination(integration.id, input.kind, { externalKey: item.key }) : null)
  if (duplicate)
    throw new ConflictError('DESTINATION_EXISTS', `${duplicate.externalId} is already synced`)

  let created: IntegrationDestination
  try {
    const rows = await db
      .insert(integrationDestinations)
      .values({
        integrationId: integration.id,
        kind: input.kind,
        externalId: item.id,
        externalKey: item.key ?? null,
        config: (await multiple.initialConfig?.(integration.id)) ?? {},
      })
      .returning()
    created = rows[0]
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError('DESTINATION_EXISTS', `${item.id} is already synced`)
    throw error
  }

  const config = (integration.config ?? {}) as Record<string, unknown>
  if (typeof config.channelId !== 'string' || !config.channelId)
    await db
      .update(integrations)
      .set({
        config: sql`jsonb_set(${integrations.config}, '{channelId}', to_jsonb(${item.id}::text))`,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integration.id))
  await mirrorDestinationEventMappings(integration.id)
  await clearMappingCache()

  const webhookWanted = multiple.webhookWanted
    ? await multiple.webhookWanted(destinationConfig(integration, created))
    : !!config.statusSyncEnabled
  if (webhookWanted) {
    try {
      const { accessToken } = await getIntegrationAuth(integration.id)
      await registerDestinationWebhook({ integration, destination: created, accessToken })
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      log.warn({ err, destination_id: created.id }, 'new destination webhook registration failed')
      await recordDestinationError(created.id, `Failed to register webhook: ${raw}`)
    }
  }
  return (await findDestination(integration.id, input.kind, { id: created.id })) ?? created
}

/**
 * Stop syncing a destination. Its webhook is removed (best effort: a failure
 * is recorded on the connection, and the removal goes ahead), every post and
 * ticket link made on it is removed (each ticket gets an 'external_unlinked'
 * note), its event mappings go, and so does the row. When it was the default,
 * the oldest remaining destination becomes the default, or there is none.
 */
export async function removeDestination(destinationId: string): Promise<{
  destination: IntegrationDestination
  unlinkedTickets: number
  unlinkedPosts: number
}> {
  const { destination, integration } = await loadDestination(destinationId)
  const definition = getIntegration(integration.integrationType)

  if (destination.externalWebhookId) {
    const { accessToken } = await getIntegrationAuth(integration.id).catch(() => ({
      accessToken: '',
    }))
    const failure = await unregisterDestinationWebhook({ integration, destination, accessToken })
    if (failure)
      await recordIntegrationLastError(
        integration.id,
        `Could not remove the webhook from ${destination.externalId}: ${failure}`
      ).catch(() => {})
  }

  const scope = syncScopeFor(integration, destinationTarget(destination), definition)
  const { unlinkTicketLinksInScope } =
    await import('@/lib/server/domains/tickets/ticket-external-links.unlink')
  const unlinkedTickets = await unlinkTicketLinksInScope(integration.id, scope)
  const unlinkedPosts = await db.transaction(async (tx) => {
    const posts = await tx
      .delete(postExternalLinks)
      .where(
        and(
          eq(postExternalLinks.integrationId, integration.id),
          eq(postExternalLinks.syncScope, scope)
        )
      )
      .returning({ id: postExternalLinks.id })
    await tx
      .delete(integrationEventMappings)
      .where(
        and(
          eq(integrationEventMappings.integrationId, integration.id),
          eq(integrationEventMappings.targetKey, destination.id)
        )
      )
    await tx.delete(integrationDestinations).where(eq(integrationDestinations.id, destination.id))
    if (isDefault(integration, destination.externalId)) {
      const [next] = await listDestinations(integration.id, destination.kind, tx)
      await tx
        .update(integrations)
        .set({
          config: next
            ? sql`jsonb_set(${integrations.config}, '{channelId}', to_jsonb(${next.externalId}::text))`
            : sql`${integrations.config} - 'channelId'`,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, integration.id))
    }
    return posts.length
  })

  await mirrorDestinationEventMappings(integration.id)
  await clearMappingCache()
  return { destination, unlinkedTickets, unlinkedPosts }
}

/**
 * Switch a destination on or off. Off, its deliveries are refused and nothing
 * is sent to it; its webhook stays registered so switching it back on is
 * immediate.
 */
export async function setDestinationEnabled(
  destinationId: string,
  enabled: boolean
): Promise<IntegrationDestination> {
  const { destination } = await loadDestination(destinationId)
  const [updated] = await db
    .update(integrationDestinations)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(integrationDestinations.id, destination.id))
    .returning()
  await clearMappingCache()
  return updated
}

/** A destination's ticket opt-in, as its settings card shows it. */
export interface DestinationTicketIssues {
  /** Whether a ticket it matches gets an issue there. */
  enabled: boolean
  /** Only tickets of these teams; empty for every team. */
  teamIds: string[]
  /** Only tickets of these types; empty for every type. */
  ticketTypeIds: string[]
}

/** Every destination's ticket opt-in on one connection, by destination id. Absent: off. */
export async function listDestinationTicketIssues(
  integrationId: IntegrationId
): Promise<Map<string, DestinationTicketIssues>> {
  const rows = await db
    .select({
      targetKey: integrationEventMappings.targetKey,
      filters: integrationEventMappings.filters,
    })
    .from(integrationEventMappings)
    .where(
      and(
        eq(integrationEventMappings.integrationId, integrationId),
        eq(integrationEventMappings.eventType, 'ticket.created'),
        eq(integrationEventMappings.enabled, true)
      )
    )
  return new Map(
    rows.map((row) => [
      row.targetKey,
      {
        enabled: true,
        teamIds: row.filters?.ticketTeamIds ?? [],
        ticketTypeIds: row.filters?.ticketTypeIds ?? [],
      },
    ])
  )
}

/** Teams that exist and ticket types that are not archived: what a filter may name. */
async function assertTicketFilters(teamIds: string[], ticketTypeIds: string[]): Promise<void> {
  if (!teamIds.every((id) => isTypeId(id, 'team')))
    throw new ValidationError('INVALID_TICKET_FILTER', 'Choose teams that exist')
  if (!ticketTypeIds.every((id) => isTypeId(id, 'ticket_type')))
    throw new ValidationError('INVALID_TICKET_FILTER', 'Choose ticket types that exist')
  const liveTeams = teamIds.length
    ? await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(inArray(teams.id, teamIds as TeamId[]), isNull(teams.deletedAt)))
    : []
  if (liveTeams.length !== new Set(teamIds).size)
    throw new ValidationError('INVALID_TICKET_FILTER', 'Choose teams that exist')
  const liveTypes = ticketTypeIds.length
    ? await db
        .select({ id: ticketTypes.id })
        .from(ticketTypes)
        .where(
          and(
            inArray(ticketTypes.id, ticketTypeIds as TicketTypeId[]),
            isNull(ticketTypes.deletedAt)
          )
        )
    : []
  if (liveTypes.length !== new Set(ticketTypeIds).size)
    throw new ValidationError('INVALID_TICKET_FILTER', 'Choose ticket types that exist')
}

/**
 * Switch a destination's ticket opt-in on, off, or change its filters. On, it
 * gets its own `ticket.created` and `ticket.assigned` mappings, routed to it
 * with the filters given; off, they go. Switching on stamps the opt-in, so only
 * tickets opened from then on get an issue (see `ticketIssueAllowed`); a
 * filter change while it is on keeps that moment. Only for a provider that
 * creates tracked issues.
 */
export async function setDestinationTicketIssues(
  destinationId: string,
  settings: DestinationTicketIssues
): Promise<DestinationTicketIssues> {
  const { destination, integration } = await loadDestination(destinationId)
  multipleOf(integration.integrationType)
  const definition = getIntegration(integration.integrationType)
  if (!definition?.linkedItems || !definition.issues?.create)
    throw new ValidationError('NOT_SUPPORTED', 'This integration does not create issues')
  const teamIds = [...new Set(settings.teamIds)]
  const ticketTypeIds = [...new Set(settings.ticketTypeIds)]
  const where = and(
    eq(integrationEventMappings.integrationId, integration.id),
    eq(integrationEventMappings.targetKey, destination.id),
    inArray(integrationEventMappings.eventType, [...TICKET_ISSUE_EVENTS])
  )
  if (!settings.enabled) {
    await db.delete(integrationEventMappings).where(where)
  } else {
    await assertTicketFilters(teamIds, ticketTypeIds)
    const filters = {
      ...(teamIds.length ? { ticketTeamIds: teamIds } : {}),
      ...(ticketTypeIds.length ? { ticketTypeIds } : {}),
    }
    await db
      .insert(integrationEventMappings)
      .values(
        TICKET_ISSUE_EVENTS.map((eventType) => ({
          integrationId: integration.id,
          eventType,
          actionType: 'send_message',
          targetKey: destination.id as string,
          actionConfig: { channelId: destination.externalId },
          filters,
          enabled: true,
        }))
      )
      .onConflictDoUpdate({
        target: [
          integrationEventMappings.integrationId,
          integrationEventMappings.eventType,
          integrationEventMappings.actionType,
          integrationEventMappings.targetKey,
        ],
        set: {
          actionConfig: sql`excluded.action_config`,
          filters: sql`excluded.filters`,
          updatedAt: new Date(),
        },
      })
  }
  await clearMappingCache()
  return { enabled: settings.enabled, teamIds, ticketTypeIds }
}

/**
 * Patch a destination's settings. The provider's `configSchema` decides which
 * keys exist and what they may hold, and its `validateConfig` checks what
 * they name; anything else is refused.
 */
export async function updateDestinationConfig(
  destinationId: string,
  patch: Record<string, unknown>
): Promise<IntegrationDestination> {
  const { destination, integration } = await loadDestination(destinationId)
  const multiple = multipleOf(integration.integrationType)
  const parsed = multiple.configSchema.safeParse(patch)
  if (!parsed.success)
    throw new ValidationError('INVALID_DESTINATION_CONFIG', 'These settings are not valid here')
  await multiple.validateConfig?.(parsed.data)
  // Switching replies-as-comments on records when, the boundary no earlier
  // reply is ever posted across.
  const config =
    parsed.data.postRepliesAsComments === true && destination.config.postRepliesAsComments !== true
      ? { ...parsed.data, postRepliesAsCommentsSince: new Date().toISOString() }
      : parsed.data
  const [updated] = await db
    .update(integrationDestinations)
    .set({
      config: sql`${integrationDestinations.config} || ${JSON.stringify(config)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(integrationDestinations.id, destination.id))
    .returning()
  await clearMappingCache()
  await multiple.onConfigChanged?.(updated)
  return updated
}
