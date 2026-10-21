/**
 * Integration destinations: the repositories (later teams, projects) one
 * connection serves. A provider opts in with `destination.multiple` on its
 * definition; the connection's token, mappings and status-sync switch stay on
 * the `integrations` row, while each destination carries its own webhook, its
 * own encrypted signing secret and its own health.
 *
 * Provider code is written against a single `config.channelId`. Rather than
 * teach every provider about destinations, `destinationConfig` hands it the
 * connection's config with `channelId` set to the destination, so the same
 * `webhookRegistration.register/unregister` serves each repository in turn.
 */
import type { IntegrationDestinationId, IntegrationId } from '@quackback/ids'
import {
  db,
  eq,
  and,
  sql,
  asc,
  integrations,
  integrationDestinations,
  type Database,
  type Transaction,
  type IntegrationDestinationConfig,
} from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { ValidationError } from '@/lib/shared/errors'
import { encryptSecrets, decryptSecrets } from './encryption'
import { generateWebhookSecret, buildWebhookCallbackUrl } from './webhook-registration'

const log = logger.child({ component: 'integration-destinations' })

export type IntegrationDestination = typeof integrationDestinations.$inferSelect
type IntegrationRow = typeof integrations.$inferSelect

/** What a signed inbound delivery says about where it came from. */
export interface DestinationRef {
  externalId: string
  externalKey?: string
}

/** Which way a destination syncs; `both` when its config does not say. */
export type DestinationDirection = NonNullable<IntegrationDestinationConfig['direction']>
export const DESTINATION_DIRECTIONS = ['both', 'outbound', 'inbound'] as const

export function destinationDirection(
  destination: Pick<IntegrationDestination, 'config'>
): DestinationDirection {
  const direction = destination.config?.direction
  return direction === 'outbound' || direction === 'inbound' ? direction : 'both'
}

/** Whether we may send to it: created issues, feedback issues. Switched off or inbound-only: no. */
export function destinationSends(
  destination: Pick<IntegrationDestination, 'config' | 'enabled'>
): boolean {
  return destination.enabled && destinationDirection(destination) !== 'inbound'
}

/** Whether its deliveries are acted on. Switched off or outbound-only: no. */
export function destinationReceives(
  destination: Pick<IntegrationDestination, 'config' | 'enabled'>
): boolean {
  return destination.enabled && destinationDirection(destination) !== 'outbound'
}

/** The target provider code and link scopes name a destination by. */
export function destinationTarget(destination: Pick<IntegrationDestination, 'externalId'>): {
  channelId: string
} {
  return { channelId: destination.externalId }
}

/** The encrypted `secrets` blob. */
interface DestinationSecrets {
  webhookSecret?: string
}

/** Lazy registry import: provider modules import this file, so a static import would cycle. */
async function definitionOf(integrationType: string) {
  const { getIntegration } = await import('./index')
  return getIntegration(integrationType)
}

export async function listDestinations(
  integrationId: IntegrationId,
  kind?: string,
  executor: Database | Transaction = db
): Promise<IntegrationDestination[]> {
  return executor
    .select()
    .from(integrationDestinations)
    .where(
      and(
        eq(integrationDestinations.integrationId, integrationId),
        kind ? eq(integrationDestinations.kind, kind) : undefined
      )
    )
    .orderBy(asc(integrationDestinations.createdAt), asc(integrationDestinations.id))
}

/**
 * The names of every destination a connection serves, for matching a link's
 * scope to its repository (see `linkTarget`). Empty for a provider without
 * destination rows, whose links all belong to `config.channelId`.
 */
export async function destinationChannelIds(
  integration: { id: string; integrationType: string },
  executor: Database | Transaction = db
): Promise<string[]> {
  if (!(await definitionOf(integration.integrationType))?.destination?.multiple) return []
  return (await listDestinations(integration.id as IntegrationId, undefined, executor)).map(
    (d) => d.externalId
  )
}

/** By row id, by name (case-insensitive, as GitHub treats repository names) or by immutable key. */
export async function findDestination(
  integrationId: IntegrationId,
  kind: string,
  match: { id: IntegrationDestinationId } | { externalId: string } | { externalKey: string }
): Promise<IntegrationDestination | null> {
  const by =
    'id' in match
      ? eq(integrationDestinations.id, match.id)
      : 'externalId' in match
        ? sql`lower(${integrationDestinations.externalId}) = lower(${match.externalId})`
        : eq(integrationDestinations.externalKey, match.externalKey)
  const [row] = await db
    .select()
    .from(integrationDestinations)
    .where(
      and(
        eq(integrationDestinations.integrationId, integrationId),
        eq(integrationDestinations.kind, kind),
        by
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Whether outbound work (an issue for new feedback, an issue created from a
 * ticket) may go to `channelId` on this connection now. A connection without
 * destination rows sends to its `config.channelId` as it always has;
 * otherwise the named destination must exist, be switched on and not be
 * inbound-only.
 */
export async function outboundAllowed(
  integration: Pick<IntegrationRow, 'id' | 'integrationType'>,
  channelId: unknown
): Promise<boolean> {
  const multiple = (await definitionOf(integration.integrationType))?.destination?.multiple
  if (!multiple) return true
  const rows = await listDestinations(integration.id, multiple.kind)
  if (rows.length === 0) return true
  const name = typeof channelId === 'string' ? channelId.toLowerCase() : null
  const destination = rows.find((row) => row.externalId.toLowerCase() === name)
  return !!destination && destinationSends(destination)
}

/**
 * Where new work created on request goes: the destination asked for, else
 * the default one (`config.channelId`), else the only one that takes new
 * work. Refuses a destination that is switched off or inbound-only, and asks
 * for a choice when several could take it. A connection without destination
 * rows creates in `config.channelId`.
 */
export async function outboundTarget(
  integration: Pick<IntegrationRow, 'id' | 'integrationType' | 'config'>,
  destinationId?: string
): Promise<{ channelId: unknown }> {
  const config = (integration.config ?? {}) as Record<string, unknown>
  const multiple = (await definitionOf(integration.integrationType))?.destination?.multiple
  const rows = multiple ? await listDestinations(integration.id, multiple.kind) : []
  if (!multiple || rows.length === 0) return { channelId: config.channelId }
  const noun = multiple.label.toLowerCase()

  if (destinationId) {
    const chosen = rows.find((row) => row.id === destinationId)
    if (!chosen)
      throw new ValidationError('DESTINATION_NOT_FOUND', `Choose a ${noun} this connection syncs`)
    if (!destinationSends(chosen))
      throw new ValidationError(
        'DESTINATION_UNAVAILABLE',
        `${chosen.externalId} does not take new issues. Turn it on or let it sync outbound.`
      )
    return destinationTarget(chosen)
  }

  const sending = rows.filter(destinationSends)
  const fallback =
    sending.find(
      (row) =>
        typeof config.channelId === 'string' &&
        row.externalId.toLowerCase() === config.channelId.toLowerCase()
    ) ?? (sending.length === 1 ? sending[0] : undefined)
  if (!fallback)
    throw new ValidationError(
      'DESTINATION_REQUIRED',
      sending.length === 0
        ? `No ${noun} takes new issues. Turn one on or let it sync outbound.`
        : `Choose a ${noun}`
    )
  return destinationTarget(fallback)
}

/**
 * The config provider code sees when it acts for one destination: the
 * connection's config, the destination's own settings over it, and
 * `channelId` naming the destination. The connection-level webhook keys a
 * single-destination install kept are left out, so they can never be mistaken
 * for this destination's webhook.
 */
export function destinationConfig(
  integration: { config: unknown },
  destination: Pick<IntegrationDestination, 'config' | 'externalId'>
): Record<string, unknown> {
  const {
    webhookSecret: _secret,
    externalWebhookId: _webhookId,
    ...connection
  } = (integration.config ?? {}) as Record<string, unknown>
  return { ...connection, ...destination.config, channelId: destination.externalId }
}

export function readDestinationSecret(
  destination: Pick<IntegrationDestination, 'secrets'>
): string | null {
  if (!destination.secrets) return null
  return decryptSecrets<DestinationSecrets>(destination.secrets).webhookSecret ?? null
}

/** Store what the provider registered. A null secret and id record that there is no webhook. */
export async function writeDestinationWebhook(
  destinationId: IntegrationDestinationId,
  webhook: { secret: string | null; externalWebhookId: string | null; events: string[] | null }
): Promise<void> {
  await db
    .update(integrationDestinations)
    .set({
      secrets: webhook.secret
        ? encryptSecrets({ webhookSecret: webhook.secret } satisfies DestinationSecrets)
        : null,
      externalWebhookId: webhook.externalWebhookId,
      webhookEvents: webhook.events,
      updatedAt: new Date(),
    })
    .where(eq(integrationDestinations.id, destinationId))
}

export async function recordDestinationError(
  destinationId: IntegrationDestinationId,
  message: string
): Promise<void> {
  await db
    .update(integrationDestinations)
    .set({ lastError: message.slice(0, 1000), lastErrorAt: new Date(), updatedAt: new Date() })
    .where(eq(integrationDestinations.id, destinationId))
}

export async function clearDestinationError(
  destinationId: IntegrationDestinationId
): Promise<void> {
  await db
    .update(integrationDestinations)
    .set({ lastError: null, lastErrorAt: null, updatedAt: new Date() })
    .where(eq(integrationDestinations.id, destinationId))
}

/**
 * The destination a signed delivery belongs to. The immutable key wins, so a
 * renamed repository is still found; a name now held by a different
 * repository (the old one was renamed away or deleted) is not a match.
 */
export async function findInboundDestination(
  integrationId: IntegrationId,
  kind: string,
  ref: DestinationRef
): Promise<IntegrationDestination | null> {
  if (ref.externalKey) {
    const byKey = await findDestination(integrationId, kind, { externalKey: ref.externalKey })
    if (byKey) return byKey
  }
  const byName = await findDestination(integrationId, kind, { externalId: ref.externalId })
  if (byName?.externalKey && ref.externalKey && byName.externalKey !== ref.externalKey) return null
  return byName
}

/**
 * Record a verified delivery: stamp `last_inbound_at`, learn the immutable key
 * the backfill could not know, and follow a rename. Runs only after the
 * signature checked out, so an unsigned payload can never rename anything.
 */
export async function markDestinationInbound(
  integration: Pick<IntegrationRow, 'id'>,
  destination: IntegrationDestination,
  ref: DestinationRef
): Promise<void> {
  await db
    .update(integrationDestinations)
    .set({
      lastInboundAt: new Date(),
      ...(ref.externalKey && !destination.externalKey ? { externalKey: ref.externalKey } : {}),
    })
    .where(eq(integrationDestinations.id, destination.id))
  if (destination.externalId === ref.externalId) return

  try {
    await db
      .update(integrationDestinations)
      .set({ externalId: ref.externalId, updatedAt: new Date() })
      .where(eq(integrationDestinations.id, destination.id))
    // The default repository follows the rename, so new issues land under the current name.
    const [moved] = await db
      .update(integrations)
      .set({
        config: sql`jsonb_set(${integrations.config}, '{channelId}', to_jsonb(${ref.externalId}::text))`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrations.id, integration.id),
          sql`${integrations.config}->>'channelId' = ${destination.externalId}`
        )
      )
      .returning({ id: integrations.id })
    if (moved) {
      const { cacheDel, CACHE_KEYS } = await import('@/lib/server/cache')
      await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
    }
  } catch (err) {
    // Another destination already holds the new name; keep delivering under the old one.
    log.warn({ err, destination_id: destination.id }, 'destination rename not followed')
  }
}

async function automaticRegistration(integrationType: string) {
  const registration = (await definitionOf(integrationType))?.webhookRegistration
  if (!registration || registration === 'manual')
    throw new Error('This integration does not register webhooks automatically')
  return registration
}

/**
 * Register (or re-register) one destination's webhook and store its id,
 * events and encrypted secret. Keeps the destination's existing secret so a
 * repair never invalidates deliveries already in flight. Throws the
 * provider's error; the caller records it where its user will see it.
 */
export async function registerDestinationWebhook(params: {
  integration: Pick<IntegrationRow, 'integrationType' | 'config'>
  destination: IntegrationDestination
  accessToken: string
}): Promise<void> {
  const { integration, destination, accessToken } = params
  const registration = await automaticRegistration(integration.integrationType)
  const secret = readDestinationSecret(destination) ?? generateWebhookSecret()
  const result = await registration.register({
    accessToken,
    config: destinationConfig(integration, destination),
    callbackUrl: buildWebhookCallbackUrl(integration.integrationType),
    secret,
  })
  await writeDestinationWebhook(destination.id, {
    secret: result.webhookSecret ?? secret,
    externalWebhookId: result.externalWebhookId ?? null,
    events: result.events ?? null,
  })
}

/**
 * Register the webhook of every enabled destination of `kind`, one at a time
 * so one repository's failure cannot stop the others. Each failure is
 * recorded on its destination and returned, named, for the caller to report.
 */
export async function registerDestinationWebhooks(params: {
  integration: Pick<IntegrationRow, 'id' | 'integrationType' | 'config'>
  kind: string
  accessToken: string
}): Promise<{ registered: number; failures: string[] }> {
  const destinations = (await listDestinations(params.integration.id, params.kind)).filter(
    (destination) => destination.enabled
  )
  let registered = 0
  const failures: string[] = []
  for (const destination of destinations) {
    try {
      await registerDestinationWebhook({
        integration: params.integration,
        destination,
        accessToken: params.accessToken,
      })
      await clearDestinationError(destination.id)
      registered++
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      failures.push(`${destination.externalId}: ${raw}`)
      await recordDestinationError(destination.id, `Failed to register webhook: ${raw}`).catch(
        () => {}
      )
    }
  }
  return { registered, failures }
}

/**
 * Remove the provider-side webhook. Best effort: a failure is logged and its
 * message returned, never thrown. Null when there was nothing to remove or it
 * went.
 */
async function removeRemoteWebhook(
  integration: Pick<IntegrationRow, 'integrationType' | 'config'>,
  destination: IntegrationDestination,
  accessToken: string
): Promise<string | null> {
  if (!destination.externalWebhookId || !accessToken) return null
  try {
    const registration = await automaticRegistration(integration.integrationType)
    await registration.unregister({
      accessToken,
      config: destinationConfig(integration, destination),
      externalWebhookId: destination.externalWebhookId,
    })
    return null
  } catch (err) {
    log.warn(
      { err, integration_type: integration.integrationType, destination_id: destination.id },
      'destination webhook removal failed'
    )
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Remove one destination's webhook and forget it locally, even if the
 * provider call failed. Returns that failure's message, or null.
 */
export async function unregisterDestinationWebhook(params: {
  integration: Pick<IntegrationRow, 'integrationType' | 'config'>
  destination: IntegrationDestination
  accessToken: string
}): Promise<string | null> {
  const failure = await removeRemoteWebhook(
    params.integration,
    params.destination,
    params.accessToken
  )
  await writeDestinationWebhook(params.destination.id, {
    secret: null,
    externalWebhookId: null,
    events: null,
  })
  return failure
}

/**
 * Remove every destination's provider-side webhook, for a caller about to
 * delete the rows themselves: a disconnect (the rows go with the connection by
 * cascade) or a repository switch. A disconnect passes its transaction so a
 * one-connection pool cannot deadlock on the read.
 */
export async function unregisterDestinationWebhooks(params: {
  integration: Pick<IntegrationRow, 'id' | 'integrationType' | 'config'>
  accessToken: string
  executor?: Database | Transaction
}): Promise<void> {
  const destinations = await listDestinations(params.integration.id, undefined, params.executor)
  for (const destination of destinations)
    await removeRemoteWebhook(params.integration, destination, params.accessToken)
}

/**
 * Repair a connection whose destination still lives only in the legacy
 * connection config: create the destination for `config.channelId` when it is
 * missing, and move the plaintext `config.webhookSecret` (and its hook id)
 * into that destination, encrypted. The migration backfills the row but
 * cannot encrypt, so until this runs the inbound handler verifies with the
 * legacy secret. `config.channelId` stays as the default destination.
 */
export async function ensureDestinations(
  integration: Pick<IntegrationRow, 'id' | 'integrationType' | 'config'>
): Promise<void> {
  const multiple = (await definitionOf(integration.integrationType))?.destination?.multiple
  if (!multiple) return
  const config = (integration.config ?? {}) as Record<string, unknown>
  const channelId = typeof config.channelId === 'string' ? config.channelId : ''
  if (!channelId) return
  const legacyHookId =
    typeof config.externalWebhookId === 'string' && config.externalWebhookId
      ? config.externalWebhookId
      : null

  await db
    .insert(integrationDestinations)
    .values({
      integrationId: integration.id,
      kind: multiple.kind,
      externalId: channelId,
      externalWebhookId: legacyHookId,
    })
    .onConflictDoNothing()

  const legacySecret = typeof config.webhookSecret === 'string' ? config.webhookSecret : null
  if (!legacySecret && !legacyHookId) return
  const destination = await findDestination(integration.id, multiple.kind, {
    externalId: channelId,
  })
  if (!destination) return
  if (!destination.secrets && legacySecret) {
    await writeDestinationWebhook(destination.id, {
      secret: legacySecret,
      externalWebhookId: destination.externalWebhookId ?? legacyHookId,
      events: destination.webhookEvents,
    })
  }
  // Remove only the moved keys, in SQL, so a concurrent config write is not clobbered.
  await db
    .update(integrations)
    .set({
      config: sql`${integrations.config} - 'webhookSecret' - 'externalWebhookId'`,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, integration.id))
}
