import {
  db,
  eq,
  and,
  desc,
  inArray,
  sql,
  integrations,
  integrationSyncOperations as operations,
  integrationSyncAttempts as attempts,
  type Ticket,
} from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { RetryAfterError } from '@/lib/server/jobs/definitions'
import {
  claimSyncOperation,
  readSyncPayload,
  finishSyncOperation,
  heartbeatSync,
  recoverExpiredSyncs,
  type SyncTransaction,
  markSyncDispatched,
  recordRemoteEvidence,
  enqueueSyncJob,
} from './ledger'
import { currentSyncIntegration, validateSyncSource } from './eligibility'
import { executeHookSync, persistSyncLink } from './hooks'
import { syncErrorOutcome } from './outcomes'
import type { SyncOutcome } from './types'
import { executeTicketCreate } from './tickets'
import { executeTicketCommentSync } from './comments'
import { executeIssueUpdate } from './issue-updates'
import { applyIdentifySync } from './identify'
import {
  fanOutInboundStatus,
  applyInboundStatus,
  parseInboundWebhook,
  queueInboundStatus,
} from './inbound'
import { applyInboundAssignee, planInboundAssignee, queueInboundAssignee } from './assignees'
import { applyInboundComment, planInboundComment, queueInboundComment } from './inbound-comments'
import { planTicketRecovery, queueTicketRecovery } from './ticket-recovery'
import { executeSegmentSync } from './segment'
import { installationIdentity } from './identity'
import { getIntegration } from '../index'
import { publishTicketUpdated } from '@/lib/server/domains/tickets/ticket-intake.service'
import { logger } from '@/lib/server/logger'
import { isFeaturePaused } from '@/lib/server/domains/plan-limits/plan-limits.service'

const log = logger.child({ component: 'integration-sync' })

/** A provider app event its handler marked as connection lifecycle (see `appHooks.handle`). */
function isLifecycleEvent(operation: Parameters<typeof readSyncPayload>[0]): boolean {
  if (operation.kind !== 'app-hook' || !operation.payload) return false
  try {
    const payload = readSyncPayload(operation)
    return payload.executor === 'app-hook' && payload.data?.lifecycle === true
  } catch {
    return false
  }
}

/** How long an inbound change is held while integrations are paused, before it is given up. */
const HELD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** An inbound change from a tracker (not an app's own events): held while paused, not dropped. */
function heldWhilePaused(operation: { direction: string; kind: string }): boolean {
  return operation.direction === 'inbound' && operation.kind !== 'app-hook'
}

function heldTooLong(operation: { createdAt: Date }): boolean {
  return Date.now() - operation.createdAt.getTime() > HELD_MAX_AGE_MS
}

/**
 * Queue again the inbound changes held while integrations were paused, once
 * the plan includes integrations; give up any held past the maximum age. The
 * plan state is read only when something is held.
 */
export async function resumeHeldSyncs(): Promise<void> {
  const held = await db
    .select({ id: operations.id, createdAt: operations.createdAt })
    .from(operations)
    .where(and(eq(operations.state, 'retry_wait'), eq(operations.errorCode, 'plan_paused')))
    .limit(200)
  if (held.length === 0) return
  const expired = held.filter(heldTooLong).map((op) => op.id)
  if (expired.length > 0) {
    log.warn(
      { count: expired.length },
      'inbound changes held past the maximum age while integrations were paused; given up'
    )
    await db
      .update(operations)
      .set({
        state: 'cancelled',
        finishedAt: new Date(),
        version: sql`${operations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(operations.id, expired),
          eq(operations.state, 'retry_wait'),
          eq(operations.errorCode, 'plan_paused')
        )
      )
  }
  if (held.length === expired.length || (await isFeaturePaused('integrations'))) return
  await db.transaction(async (tx) => {
    const resumed = await tx
      .update(operations)
      .set({
        state: 'queued',
        errorCode: null,
        version: sql`${operations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(
            operations.id,
            held.filter((op) => !expired.includes(op.id)).map((op) => op.id)
          ),
          eq(operations.state, 'retry_wait'),
          eq(operations.errorCode, 'plan_paused')
        )
      )
      .returning({
        id: operations.id,
        version: operations.version,
        provider: operations.provider,
        kind: operations.kind,
      })
    for (const op of resumed) await enqueueSyncJob(op, tx)
    if (resumed.length > 0) log.info({ count: resumed.length }, 'held inbound changes resumed')
  })
}

export async function runIntegrationSync(job: ClaimedJob): Promise<void> {
  const id = job.payload.operationId
  if (typeof id !== 'string') return
  const claim = await claimSyncOperation(
    id,
    typeof job.payload.version === 'number' ? job.payload.version : undefined
  )
  if (!claim) return
  // Paused after the plan limits grace. Outbound feature traffic and app
  // events are settled as cancelled, so nothing is sent now or replayed after
  // an upgrade. An inbound change from a tracker is held and applied after an
  // upgrade. A provider lifecycle event (an uninstall, a token revocation)
  // always runs: it changes the connection itself. Connections and tokens are
  // kept.
  if (!isLifecycleEvent(claim.operation) && (await isFeaturePaused('integrations'))) {
    const fields = { operationId: id, provider: claim.operation.provider }
    if (heldWhilePaused(claim.operation) && !heldTooLong(claim.operation)) {
      // An inbound change waits instead: the sync sweep queues it again
      // once the plan includes integrations (resumeHeldSyncs).
      log.info(fields, 'integrations paused on this plan; inbound change held')
      await finishSyncOperation(claim, { state: 'retry_wait', errorCode: 'plan_paused' })
      return
    }
    log.info(fields, 'integrations paused on this plan; sync cancelled')
    await finishSyncOperation(claim, { state: 'cancelled', errorCode: 'plan_paused' })
    return
  }
  const heartbeat = setInterval(() => {
    void heartbeatSync(claim).catch(() => undefined)
  }, 20_000)
  heartbeat.unref?.()
  try {
    let outcome: SyncOutcome
    let localWrite: ((tx: SyncTransaction) => Promise<void | SyncOutcome>) | undefined
    const updatedTickets: Ticket[] = []
    try {
      const integration = await currentSyncIntegration(claim.operation)
      const invalid = await validateSyncSource(claim.operation)
      if (!integration) outcome = { state: 'cancelled', errorCode: 'installation_changed' }
      else if (invalid) outcome = invalid
      else if (!claim.operation.payload) outcome = { state: 'failed', errorCode: 'missing_payload' }
      else {
        const payload = readSyncPayload(claim.operation)
        if (payload.reconcileOnly) {
          const [evidence] = await db
            .select({ result: attempts.result })
            .from(attempts)
            .where(
              and(
                eq(attempts.operationId, id),
                sql`${attempts.result} IS NOT NULL`,
                sql`${attempts.state} IN ('remote_succeeded', 'late_result', 'succeeded', 'uncertain')`
              )
            )
            .orderBy(desc(attempts.number))
            .limit(1)
          outcome =
            evidence?.result &&
            (claim.operation.kind !== 'create' || typeof evidence.result.externalId === 'string')
              ? { state: 'succeeded', result: evidence.result }
              : { state: 'uncertain', errorCode: 'outcome_unknown' }
        } else if (payload.executor === 'app-hook') {
          const execute = getIntegration(claim.operation.provider)?.appHooks?.execute
          if (!execute) outcome = { state: 'failed', errorCode: 'provider_failed' }
          else if (!(await markSyncDispatched(claim))) outcome = { state: 'cancelled' }
          else {
            await execute({ ...job, payload: payload.data })
            outcome = { state: 'succeeded' }
          }
        } else if (payload.executor === 'inbound-webhook') {
          const results = await parseInboundWebhook(integration, payload.data)
          const assignee = await planInboundAssignee(integration, payload.data)
          const comment = await planInboundComment(integration, payload.data)
          const recovery = await planTicketRecovery(integration, payload.data)
          outcome = { state: 'succeeded', result: { received: results.length } }
          localWrite = async (tx) => {
            for (const [index, result] of results.entries())
              await queueInboundStatus(
                integration,
                result,
                `${payload.data.deliveryKey}:${index}`,
                tx
              )
            if (assignee)
              await queueInboundAssignee(
                tx,
                integration,
                assignee,
                String(payload.data.deliveryKey)
              )
            if (comment)
              await queueInboundComment(tx, integration, comment, String(payload.data.deliveryKey))
            if (recovery) await queueTicketRecovery(tx, integration, recovery)
          }
        } else if (payload.executor === 'inbound-status') {
          outcome = { state: 'succeeded' }
          localWrite = (tx) =>
            claim.operation.kind === 'receive-status'
              ? fanOutInboundStatus(tx, claim, integration, payload.data)
              : applyInboundStatus(tx, claim, integration, payload.data, updatedTickets)
        } else if (payload.executor === 'inbound-assignee') {
          outcome = await applyInboundAssignee(claim, integration, payload.data)
        } else if (payload.executor === 'inbound-comment') {
          outcome = await applyInboundComment(claim, integration, payload.data)
        } else if (payload.executor === 'identify') {
          outcome = { state: 'succeeded' }
          localWrite = (tx) => applyIdentifySync(tx, claim, payload.data)
        } else if (payload.executor === 'hook')
          outcome = await executeHookSync(claim, payload.data, integration)
        else if (payload.executor === 'ticket-create')
          outcome = await executeTicketCreate(claim, integration)
        else if (payload.executor === 'ticket-comment')
          outcome = await executeTicketCommentSync(claim, integration)
        else if (payload.executor === 'remote-update')
          outcome = await executeIssueUpdate(claim, integration)
        else if (payload.executor === 'segment')
          outcome = await executeSegmentSync(claim, payload.data, integration)
        else if (
          payload.executor === 'refresh' ||
          payload.executor === 'archive' ||
          payload.executor === 'relink'
        )
          outcome = { state: 'conflict', errorCode: 'manual_update' }
        else outcome = { state: 'failed', errorCode: 'provider_failed' }
      }
    } catch (error) {
      const current = await db.query.integrationSyncOperations.findFirst({
        where: eq(operations.id, id),
      })
      outcome = syncErrorOutcome(error, !!current?.dispatchedAt)
    }
    try {
      await finishSyncOperation(
        claim,
        outcome,
        outcome.state === 'succeeded'
          ? localWrite
            ? async (tx) => {
                const [current] = await tx
                  .select()
                  .from(integrations)
                  .where(eq(integrations.id, claim.operation.integrationId as never))
                  .for('share')
                if (
                  !current ||
                  current.status !== 'active' ||
                  installationIdentity(current) !== claim.operation.installation
                )
                  return { state: 'cancelled' as const, errorCode: 'installation_changed' as const }
                return localWrite!(tx)
              }
            : (tx) => persistSyncLink(tx, claim, outcome.result ?? {})
          : undefined
      )
    } catch {
      if (localWrite) {
        await finishSyncOperation(claim, { state: 'retry_wait', errorCode: 'unavailable' })
        throw new Error('Local sync transaction will be retried')
      }
      // Do not replay the remote call when finalization fails. Save evidence separately if possible.
      if (outcome.state === 'succeeded') {
        await recordRemoteEvidence(claim, outcome.result ?? {}).catch(() => undefined)
        await finishSyncOperation(claim, {
          state: 'uncertain',
          errorCode: 'local_persistence',
        }).catch(() => undefined)
      }
      throw new Error('Integration sync could not record its outcome')
    }
    // Realtime is the usual best-effort post-write tail. A rollback never
    // reaches here, and a publish failure must not replay a committed change.
    for (const ticket of updatedTickets) {
      try {
        await publishTicketUpdated(ticket)
      } catch (error) {
        log.warn({ err: error, ticketId: ticket.id }, 'Could not publish synced ticket update')
      }
    }
    if (outcome.state === 'retry_wait')
      throw new RetryAfterError(
        'Integration sync is waiting for a retry',
        outcome.retryAfterMs ?? 0
      )
  } finally {
    clearInterval(heartbeat)
  }
}

export async function onIntegrationSyncFailure(
  job: ClaimedJob,
  _error: unknown,
  permanent: boolean
): Promise<void> {
  if (!permanent || typeof job.payload.operationId !== 'string') return
  await db
    .update(operations)
    .set({
      state: sql`CASE WHEN ${operations.dispatchedAt} IS NOT NULL THEN 'uncertain' ELSE 'failed' END`,
      errorCode: 'unavailable',
      version: sql`${operations.version} + 1`,
      updatedAt: new Date(),
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(operations.id, job.payload.operationId),
        sql`(${operations.state} = 'retry_wait' OR (${operations.state} = 'queued' AND ${operations.version} = ${typeof job.payload.version === 'number' ? job.payload.version : -1}))`
      )
    )
}

/** Hands a sync whose worker died mid-flight back to the queue, or to review. */
export async function sweepIntegrationSync(): Promise<void> {
  await recoverExpiredSyncs()
  await resumeHeldSyncs()
}

/**
 * Detailed resolved history expires, but compact operation identity is permanent.
 *
 * Daily rather than on the recovery sweep's minute: history becomes eligible at
 * ninety days, so a minute's precision bought nothing but a scan of every
 * workspace's sync history 1,440 times a day.
 */
export async function pruneIntegrationSyncHistory(): Promise<void> {
  await db.execute(sql`DELETE FROM integration_sync_attempts WHERE operation_id IN (
    SELECT id FROM integration_sync_operations WHERE state IN ('succeeded', 'cancelled', 'superseded') AND finished_at < now() - interval '90 days')`)
  await db.execute(sql`UPDATE integration_sync_operations SET payload = NULL, result = NULL
    WHERE state IN ('succeeded', 'cancelled', 'superseded') AND finished_at < now() - interval '90 days' AND (payload IS NOT NULL OR result IS NOT NULL)`)
}
