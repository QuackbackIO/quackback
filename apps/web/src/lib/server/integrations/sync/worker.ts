import {
  db,
  eq,
  and,
  desc,
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
} from './ledger'
import { currentSyncIntegration, validateSyncSource } from './eligibility'
import { executeHookSync, persistSyncLink } from './hooks'
import { syncErrorOutcome } from './outcomes'
import type { SyncOutcome } from './types'
import { executeTicketCreate } from './tickets'
import { applyIdentifySync } from './identify'
import {
  fanOutInboundStatus,
  applyInboundStatus,
  parseInboundWebhook,
  queueInboundStatus,
} from './inbound'
import { executeSegmentSync } from './segment'
import { installationIdentity } from './identity'
import { getIntegration } from '../index'
import { publishTicketUpdated } from '@/lib/server/domains/tickets/ticket-intake.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'integration-sync' })

export async function runIntegrationSync(job: ClaimedJob): Promise<void> {
  const id = job.payload.operationId
  if (typeof id !== 'string') return
  const claim = await claimSyncOperation(
    id,
    typeof job.payload.version === 'number' ? job.payload.version : undefined
  )
  if (!claim) return
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
          outcome = { state: 'succeeded', result: { received: results.length } }
          localWrite = async (tx) => {
            for (const [index, result] of results.entries())
              await queueInboundStatus(
                integration,
                result,
                `${payload.data.deliveryKey}:${index}`,
                tx
              )
          }
        } else if (payload.executor === 'inbound-status') {
          outcome = { state: 'succeeded' }
          localWrite = (tx) =>
            claim.operation.kind === 'receive-status'
              ? fanOutInboundStatus(tx, claim, integration, payload.data)
              : applyInboundStatus(tx, claim, integration, payload.data, updatedTickets)
        } else if (payload.executor === 'identify') {
          outcome = { state: 'succeeded' }
          localWrite = (tx) => applyIdentifySync(tx, claim, payload.data)
        } else if (payload.executor === 'hook')
          outcome = await executeHookSync(claim, payload.data, integration)
        else if (payload.executor === 'ticket-create')
          outcome = await executeTicketCreate(claim, integration)
        else if (payload.executor === 'segment')
          outcome = await executeSegmentSync(claim, payload.data, integration)
        else if (payload.executor === 'refresh' || payload.executor === 'archive')
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

export async function sweepIntegrationSync(): Promise<void> {
  await recoverExpiredSyncs()
  // Detailed resolved history expires, but compact operation identity is permanent.
  await db.execute(sql`DELETE FROM integration_sync_attempts WHERE operation_id IN (
    SELECT id FROM integration_sync_operations WHERE state IN ('succeeded', 'cancelled', 'superseded') AND finished_at < now() - interval '90 days')`)
  await db.execute(sql`UPDATE integration_sync_operations SET payload = NULL, result = NULL
    WHERE state IN ('succeeded', 'cancelled', 'superseded') AND finished_at < now() - interval '90 days' AND (payload IS NOT NULL OR result IS NOT NULL)`)
}
