/**
 * Keeps Jira status sync receiving events by extending its dynamic webhooks.
 *
 * Atlassian expires a dynamic webhook 30 days after it was created or last
 * refreshed, and nothing else extends it. Left alone, status sync stops with no
 * error surfaced anywhere, so each webhook is refreshed ten days before its
 * expiry. Jira ignores an unknown id on refresh, so a refresh is only believed
 * once the webhook list shows the webhook, and a replacement is registered when
 * it does not.
 *
 * ## Scheduling
 *
 * This is the deadline pattern from `jobs/deadlines.ts`, the one the snooze and
 * SLA sweeps use. The cron is per-minute and gated on a refresh being due, and
 * the deadline provider reports when the next refresh falls due. A workspace
 * whose webhooks are weeks from their refresh writes nothing and is not woken
 * for them, and a dormant workspace is woken at its refresh time rather than
 * lapsing while idle.
 *
 * ## State
 *
 * Everything lives in the integration's config, which is where the webhook id
 * already is:
 * - `externalWebhookId`: written at registration.
 * - `externalWebhookExpiresAt`: read back from the refresh response. Absent
 *   until the first refresh, which makes the webhook due at once.
 * - `externalWebhookRetryAt`: set after a failure, so a broken connection is
 *   retried hourly rather than on every tick.
 */
import type { IntegrationId } from '@quackback/ids'
import { and, db, eq, integrations, like } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { dueWithin, registerWorkspaceDeadline } from '@/lib/server/jobs/deadlines'
import {
  deleteJiraWebhook,
  jiraProjectRef,
  listJiraWebhookIds,
  refreshJiraWebhooks,
  registerJiraWebhook,
} from '@/integrations/jira/server/webhook-registration'
import { getIntegrationAuth } from './token-refresh'
import { buildWebhookCallbackUrl } from './webhook-registration'

const log = logger.child({ component: 'jira-webhook-refresh' })

const QUEUE = 'jira-webhook-refresh'
const DAY_MS = 86_400_000
/** The lifetime Atlassian gives a dynamic webhook after creation or refresh. */
const JIRA_WEBHOOK_LIFETIME_MS = 30 * DAY_MS
/** Refresh this far ahead of the expiry, which leaves room for retries. */
const REFRESH_LEAD_MS = 10 * DAY_MS
const RETRY_BACKOFF_MS = 60 * 60_000
/** Prefixes the error this job records, so it can clear only its own. */
const ERROR_PREFIX = 'Webhook refresh failed: '
/** The `LIKE` pattern that matches only the errors this job records. */
const ERROR_PATTERN = `${ERROR_PREFIX.replace(/[\\%_]/g, '\\$&')}%`

export interface JiraStatusSyncRow {
  id: IntegrationId
  config: Record<string, unknown>
  /** When the grant the refresh will use was connected; a reconnect changes it. */
  connectedAt: Date | null
}

export type RefreshOutcome = 'refreshed' | 'reregistered' | 'superseded'

export interface RefreshSummary {
  due: number
  refreshed: number
  reregistered: number
  superseded: number
  failed: number
}

function lifetimeFrom(now: Date): Date {
  return new Date(now.getTime() + JIRA_WEBHOOK_LIFETIME_MS)
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * When this integration's webhook next needs a refresh, or null while status
 * sync is off. The epoch means "at the next run": the expiry is not known yet,
 * or there is no webhook id to refresh.
 */
export function jiraWebhookRefreshDueAt(config: Record<string, unknown>): Date | null {
  if (config.statusSyncEnabled !== true) return null
  const retryAt = parseTime(config.externalWebhookRetryAt) ?? 0
  if (nonEmpty(config.externalWebhookId) === null) return new Date(retryAt)
  const expiresAt = parseTime(config.externalWebhookExpiresAt)
  const fromExpiry = expiresAt === null ? 0 : expiresAt - REFRESH_LEAD_MS
  return new Date(Math.max(fromExpiry, retryAt))
}

async function readJiraStatusSyncRows(): Promise<JiraStatusSyncRow[]> {
  const rows = await db
    .select({
      id: integrations.id,
      config: integrations.config,
      connectedAt: integrations.connectedAt,
    })
    .from(integrations)
    .where(and(eq(integrations.integrationType, 'jira'), eq(integrations.status, 'active')))
  return rows.filter((row) => jiraWebhookRefreshDueAt(row.config) !== null)
}

async function nextJiraWebhookRefreshAt(): Promise<Date | null> {
  let earliest: Date | null = null
  for (const row of await readJiraStatusSyncRows()) {
    const due = jiraWebhookRefreshDueAt(row.config)
    if (due && (!earliest || due < earliest)) earliest = due
  }
  return earliest
}

registerWorkspaceDeadline(QUEUE, nextJiraWebhookRefreshAt)

/** The cron gate: is a webhook due inside the next slot? */
export function isJiraWebhookRefreshDue(): Promise<boolean> {
  return dueWithin(QUEUE, 60_000)
}

export async function runJiraWebhookRefresh(): Promise<void> {
  const summary = await refreshDueJiraWebhooks(await readJiraStatusSyncRows(), new Date())
  if (summary.due > 0) log.info(summary, 'jira webhook refresh complete')
}

/**
 * Refresh every row whose webhook is due at `now`. One integration's failure is
 * recorded against that integration and the loop moves on, so it cannot hold the
 * others back.
 */
export async function refreshDueJiraWebhooks(
  rows: readonly JiraStatusSyncRow[],
  now: Date,
  refresh: (row: JiraStatusSyncRow, now: Date) => Promise<RefreshOutcome> = refreshJiraWebhook
): Promise<RefreshSummary> {
  const summary: RefreshSummary = {
    due: 0,
    refreshed: 0,
    reregistered: 0,
    superseded: 0,
    failed: 0,
  }
  for (const row of rows) {
    const due = jiraWebhookRefreshDueAt(row.config)
    if (due === null || due.getTime() > now.getTime()) continue
    summary.due += 1
    try {
      const outcome = await refresh(row, now)
      summary[outcome] += 1
    } catch (err) {
      summary.failed += 1
      log.error({ err, integration_id: row.id }, 'jira webhook refresh failed')
      await recordFailure(row, now, err).catch((recordErr) =>
        log.error({ err: recordErr, integration_id: row.id }, 'could not record refresh failure')
      )
    }
  }
  return summary
}

async function refreshJiraWebhook(row: JiraStatusSyncRow, now: Date): Promise<RefreshOutcome> {
  const webhookId = nonEmpty(row.config.externalWebhookId)
  const auth = await getIntegrationAuth(row.id)
  const cloudId = nonEmpty(auth.config.cloudId)
  if (!cloudId) throw new Error('No Jira Cloud ID configured')
  if (!auth.accessToken) throw new Error('Reconnect the integration to refresh its Jira webhook')

  if (webhookId) {
    const refreshed = await refreshJiraWebhooks(auth.accessToken, cloudId, [webhookId])
    // Jira ignores an id it does not recognise and still answers with success, so a
    // refresh that reports no invalid id is only believed once the webhook list shows
    // it. A list that cannot be read throws here, and the caller records a retry.
    const listed =
      !refreshed.invalidWebhookIds.includes(webhookId) &&
      (await listJiraWebhookIds(auth.accessToken, cloudId)).has(webhookId)
    if (listed) {
      // An expiry that is not in the future would make the webhook due on every
      // tick, so it is not believed; the documented lifetime is used instead.
      const reported = refreshed.expiresAt
      const expiresAt =
        reported && reported.getTime() > now.getTime() ? reported : lifetimeFrom(now)
      const applied = await writeWebhookState(row.id, expectedInputs(row, webhookId, cloudId), {
        expiresAt,
        retryAt: null,
        clearRefreshError: true,
      })
      return applied ? 'refreshed' : 'superseded'
    }
  }

  // Missing or gone: register a replacement the same way enabling status sync does.
  // A new webhook carries the documented lifetime, so it is not due again at once.
  const created = await registerJiraWebhook(
    auth.accessToken,
    cloudId,
    buildWebhookCallbackUrl('jira'),
    jiraProjectRef(auth.config.channelId)
  )
  // Jira caps an app's dynamic webhooks, so a replacement that is not stored, whether
  // a newer write won or the save failed, is deleted rather than left registered.
  const accessToken = auth.accessToken
  const discard = () =>
    deleteJiraWebhook(accessToken, cloudId, created.webhookId).catch((err) =>
      log.warn({ err, integration_id: row.id }, 'could not delete an unsaved jira webhook')
    )
  let applied: boolean
  try {
    applied = await writeWebhookState(row.id, expectedInputs(row, webhookId, cloudId), {
      webhookId: created.webhookId,
      expiresAt: lifetimeFrom(now),
      retryAt: null,
      clearRefreshError: true,
    })
  } catch (err) {
    await discard()
    throw err
  }
  if (applied) return 'reregistered'

  await discard()
  return 'superseded'
}

async function recordFailure(row: JiraStatusSyncRow, now: Date, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  await writeWebhookState(
    row.id,
    expectedInputs(row, nonEmpty(row.config.externalWebhookId), nonEmpty(row.config.cloudId)),
    {
      retryAt: new Date(now.getTime() + RETRY_BACKOFF_MS),
      lastError: `${ERROR_PREFIX}${message}`,
    }
  )
}

/**
 * Everything a refresh's work was computed from. A reconnect (to the same or another
 * site) or a project change can land while the refresh is out on the network and keep
 * the webhook id, so the guarded write compares all of them, not the id alone.
 */
interface RefreshInputs {
  webhookId: string | null
  cloudId: string | null
  projectRef: string
  connectedAt: Date | null
}

function expectedInputs(
  row: JiraStatusSyncRow,
  webhookId: string | null,
  cloudId: string | null
): RefreshInputs {
  return {
    webhookId,
    cloudId,
    projectRef: jiraProjectRef(row.config.channelId),
    connectedAt: row.connectedAt,
  }
}

interface WebhookStateChange {
  webhookId?: string
  /** `null` removes the stored value; `undefined` leaves it alone. */
  expiresAt?: Date | null
  retryAt?: Date | null
  /** Recorded with the state, under the same row lock, so it cannot land after a newer write. */
  lastError?: string
  /**
   * Clears the error an earlier failed refresh recorded, and only that error, in the
   * same transaction as the state it vouches for. A status-sync write during the
   * refresh's remote calls can have replaced the error, and that one is not this
   * job's to clear.
   */
  clearRefreshError?: boolean
}

function setOrRemove(config: Record<string, unknown>, key: string, value: Date | null | undefined) {
  if (value === undefined) return
  if (value === null) delete config[key]
  else config[key] = value.toISOString()
}

/**
 * Apply a change only while the webhook it was computed from is still the stored
 * one and status sync is still on. Returns false when nothing was written, so a
 * refresh that raced a reconnect (to the same or another Jira site) or a disable cannot
 * resurrect the old state.
 */
async function writeWebhookState(
  integrationId: IntegrationId,
  expected: RefreshInputs,
  change: WebhookStateChange
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ config: integrations.config, connectedAt: integrations.connectedAt })
      .from(integrations)
      .where(eq(integrations.id, integrationId))
      .for('update')
    if (!current) return false
    const config = (current.config ?? {}) as Record<string, unknown>
    if (config.statusSyncEnabled !== true) return false
    if (nonEmpty(config.externalWebhookId) !== expected.webhookId) return false
    if (nonEmpty(config.cloudId) !== expected.cloudId) return false
    if (jiraProjectRef(config.channelId) !== expected.projectRef) return false
    if (current.connectedAt?.getTime() !== expected.connectedAt?.getTime()) return false

    const next: Record<string, unknown> = { ...config }
    if (change.webhookId !== undefined) next.externalWebhookId = change.webhookId
    setOrRemove(next, 'externalWebhookExpiresAt', change.expiresAt)
    setOrRemove(next, 'externalWebhookRetryAt', change.retryAt)
    await tx
      .update(integrations)
      .set({
        config: next,
        updatedAt: new Date(),
        ...(change.lastError !== undefined && {
          lastError: change.lastError.slice(0, 1000),
          lastErrorAt: new Date(),
        }),
      })
      .where(eq(integrations.id, integrationId))
    if (change.clearRefreshError) {
      await tx
        .update(integrations)
        .set({ lastError: null, lastErrorAt: null })
        .where(and(eq(integrations.id, integrationId), like(integrations.lastError, ERROR_PATTERN)))
    }
    return true
  })
}
