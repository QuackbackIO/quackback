import { randomUUID } from 'node:crypto'
import { toUuid } from '@quackback/ids'
import {
  db,
  eq,
  and,
  sql,
  integrationSyncOperations as operations,
  integrationSyncAttempts as attempts,
} from '@/lib/server/db'
import { encrypt, decrypt } from '@/lib/server/encryption'
import { enqueueJob, type JobSqlExecutor } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { syncHash } from './identity'
import type { SyncClaim, SyncIntent, SyncOperation, SyncOutcome, SyncPayload } from './types'

export const SYNC_QUEUE = 'integration-sync'
export const SYNC_LEASE_MS = 90_000
const PURPOSE = 'integration-sync-payload'
export type SyncTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export function readSyncPayload(operation: SyncOperation): SyncPayload {
  if (!operation.payload) throw new Error('Sync payload unavailable')
  return JSON.parse(decrypt(operation.payload, PURPOSE)) as SyncPayload
}

export async function queueSyncOperation(
  intent: SyncIntent,
  executor?: JobSqlExecutor
): Promise<{ id: string; state: string; version: number } | null> {
  if (!executor) {
    return db.transaction((tx) => queueSyncOperation(intent, tx))
  }
  const start = await requireSyncStart(executor)
  const sourceTable = (
    {
      post: 'posts',
      ticket: 'tickets',
      user: '"user"',
      comment: 'post_comments',
      changelog: 'changelog_entries',
      conversation: 'conversations',
      message: 'conversation_messages',
    } as Record<string, string>
  )[intent.sourceType]
  const sourceRecordId = sourceTable ? toUuid(intent.sourceId as never) : null
  let available = true
  let sourceCreatedAt: string | undefined
  if (sourceTable) {
    const sourceFields: Record<string, string> = {
      user: 'id',
      conversation: 'id',
      post: 'deleted_at, moderation_state',
      comment: 'deleted_at, moderation_state, is_private',
      message: 'deleted_at, is_internal',
      changelog: 'deleted_at, published_at',
      ticket: 'deleted_at',
    }
    const [source] = getExecuteRows<{
      created_at?: string
      deleted_at?: Date | null
      moderation_state?: string
      is_private?: boolean
      is_internal?: boolean
      published_at?: string | null
    }>(
      await executor.execute(sql`
      SELECT ${sql.raw(sourceFields[intent.sourceType])}${['post', 'ticket'].includes(intent.sourceType) ? sql`, created_at` : sql``} FROM ${sql.raw(sourceTable)}
      WHERE id = ${sourceRecordId}::uuid FOR SHARE`)
    )
    sourceCreatedAt = source?.created_at
    available =
      !!source &&
      (intent.kind === 'archive' ||
        (!source.deleted_at &&
          !source.is_private &&
          !source.is_internal &&
          (!source.moderation_state || source.moderation_state === 'published') &&
          (intent.sourceType !== 'changelog' ||
            (!!source.published_at && new Date(source.published_at) <= new Date()))))
  }
  const startedAt = new Date(start.started_at).getTime()
  // Forward-only: stale outbox/webhook deliveries and historic creates do not
  // become new operations, queue jobs, or recovery items.
  if (
    (intent.kind === 'create' &&
      sourceCreatedAt &&
      new Date(sourceCreatedAt).getTime() <= startedAt) ||
    (intent.sourceRevision && Date.parse(intent.sourceRevision) <= startedAt)
  )
    return null
  const state = !available ? 'cancelled' : (intent.state ?? 'queued')
  const encrypted = available ? encrypt(JSON.stringify(intent.payload), PURPOSE) : null
  const rows = getExecuteRows<{ id: string; state: string; version: number }>(
    await executor.execute(sql`
    INSERT INTO integration_sync_operations
      (operation_key, integration_id, installation, provider, direction, kind, source_type, source_id,
       source_revision, destination, destination_key, remote_id, payload, requested_by, state, error_code, result, finished_at, source_record_id)
    VALUES (${intent.operationKey}, ${intent.integrationId}, ${intent.installation}, ${intent.provider},
      ${intent.direction}, ${intent.kind}, ${intent.sourceType}, ${intent.sourceId}, ${intent.sourceRevision ?? null},
      ${JSON.stringify(intent.destination)}::jsonb, ${syncHash(intent.destination)}, ${intent.remoteId ?? null},
      ${encrypted}, ${intent.requestedBy ?? null}, ${state}, ${available ? (intent.errorCode ?? null) : 'source_unavailable'},
      ${available && intent.result ? JSON.stringify(intent.result) : null}::jsonb,
      ${['succeeded', 'cancelled', 'superseded'].includes(state) ? new Date().toISOString() : null}::timestamptz, ${sourceRecordId}::uuid)
    ON CONFLICT (operation_key) DO UPDATE SET operation_key = EXCLUDED.operation_key
    RETURNING id, state, version
  `)
  )
  let row = rows[0]!
  // Reuse the permanent identity after a source is restored. Only a source-caused
  // cancellation with no possible remote success may resume; user cancellation
  // and uncertain/completed deliveries remain terminal for this create identity.
  if (available && intent.kind === 'create' && row.state === 'cancelled') {
    const resumed = getExecuteRows<{ id: string; state: string; version: number }>(
      await executor.execute(sql`
        UPDATE integration_sync_operations SET state = 'queued', payload = ${encrypted},
          requested_by = ${intent.requestedBy ?? null}, cancel_requested = false,
          error_code = NULL, finished_at = NULL, updated_at = now(), version = version + 1
        WHERE id = ${row.id}::uuid AND state = 'cancelled' AND error_code = 'source_unavailable'
          AND dispatched_at IS NULL AND remote_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM integration_sync_attempts
            WHERE operation_id = ${row.id}::uuid AND
              (result IS NOT NULL OR state IN ('succeeded', 'remote_succeeded', 'late_result', 'uncertain', 'manually_verified')))
        RETURNING id, state, version
      `)
    )
    row = resumed[0] ?? row
  }
  if (row.state === 'queued')
    await enqueueSyncJob({ ...row, provider: intent.provider, kind: intent.kind }, executor)
  return row
}

export async function enqueueSyncJob(
  operation: Pick<SyncOperation, 'id' | 'version' | 'provider' | 'kind'>,
  executor: JobSqlExecutor
) {
  const { id, version } = operation
  const { getIntegration } = await import('../index')
  const scheduling =
    operation.kind === 'app-hook' ? getIntegration(operation.provider)?.appHooks?.queue : undefined
  return enqueueJob({
    queue: scheduling?.name ?? SYNC_QUEUE,
    payload: { operationId: id, version },
    dedupeKey: `sync:${id}:${version}`,
    maxAttempts: scheduling?.maxAttempts ?? 6,
    executor,
  })
}

/** No remote work inside the transaction. The ownership token fences all later writes. */
export async function claimSyncOperation(
  id: string,
  queuedVersion?: number
): Promise<SyncClaim | null> {
  const token = randomUUID()
  return db.transaction(async (tx) => {
    await requireSyncStart(tx)
    const candidate = await tx.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, id),
    })
    if (!candidate) return null
    const lock = candidate.remoteId
      ? `${candidate.installation}:${candidate.destinationKey}:${candidate.remoteId}`
      : candidate.operationKey
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`)
    // Another source may target this same remote item. An uncertain write blocks successors too.
    if (candidate.remoteId) {
      const busy = getExecuteRows(
        await tx.execute(sql`
        SELECT id FROM integration_sync_operations WHERE id <> ${id}::uuid
          AND installation = ${candidate.installation} AND destination_key = ${candidate.destinationKey}
          AND remote_id = ${candidate.remoteId}
          AND (state IN ('running', 'uncertain') OR
            (dispatched_at IS NOT NULL AND state IN ('queued', 'retry_wait', 'conflict'))) LIMIT 1
      `)
      )
      if (busy.length) throw new Error('Remote item has an unfinished sync')
    }
    const [operation] = await tx
      .update(operations)
      .set({
        state: 'running',
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS),
        attempts: sql`${operations.attempts} + 1`,
        version: sql`${operations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(operations.id, id),
          sql`${operations.state} IN ('queued', 'retry_wait')`,
          queuedVersion === undefined
            ? undefined
            : sql`(${operations.state} <> 'queued' OR ${operations.version} = ${queuedVersion})`,
          eq(operations.cancelRequested, false)
        )
      )
      .returning()
    if (!operation) return null
    await tx
      .insert(attempts)
      .values({ operationId: id, number: operation.attempts, token, state: 'running' })
    return { operation, token }
  })
}

export async function heartbeatSync(claim: SyncClaim): Promise<boolean> {
  const rows = await db
    .update(operations)
    .set({ leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS) })
    .where(
      and(
        eq(operations.id, claim.operation.id),
        eq(operations.leaseToken, claim.token),
        eq(operations.state, 'running'),
        sql`${operations.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: operations.id })
  return rows.length > 0
}

/** Persist the ambiguity boundary BEFORE the HTTP request. */
export async function markSyncDispatched(claim: SyncClaim): Promise<boolean> {
  const rows = await db
    .update(operations)
    .set({ dispatchedAt: new Date() })
    .where(
      and(
        eq(operations.id, claim.operation.id),
        eq(operations.leaseToken, claim.token),
        eq(operations.state, 'running'),
        eq(operations.cancelRequested, false),
        sql`${operations.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: operations.id })
  return rows.length > 0
}

/** Completion and domain writes share one transaction; failures retain uncertainty. */
export async function finishSyncOperation(
  claim: SyncClaim,
  outcome: SyncOutcome,
  persist?: (tx: SyncTransaction) => Promise<void | SyncOutcome>
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const locked = getExecuteRows<{
      dispatched_at: Date | null
      lease_token: string | null
      state: string
      lease_expires_at: Date | null
      payload: string | null
      source_record_id: string | null
      error_code: string | null
    }>(
      await tx.execute(sql`
      SELECT dispatched_at, lease_token, state, lease_expires_at, payload, source_record_id, error_code
        FROM integration_sync_operations WHERE id = ${claim.operation.id}::uuid FOR UPDATE
    `)
    )
    const current = locked[0]
    if (current?.source_record_id && !current.payload && outcome.state === 'succeeded')
      outcome = { state: 'succeeded', result: minimalRemoteEvidence(outcome.result) }
    if (
      !current ||
      current.lease_token !== claim.token ||
      current.state !== 'running' ||
      !current.lease_expires_at ||
      new Date(current.lease_expires_at).getTime() <= Date.now()
    ) {
      // Late evidence is useful for reconciliation, but cannot overwrite a successor.
      await tx
        .update(attempts)
        .set({
          result: outcome.state === 'succeeded' ? (outcome.result ?? {}) : sql`${attempts.result}`,
          state: 'late_result',
          finishedAt: new Date(),
        })
        .where(eq(attempts.token, claim.token))
      return false
    }
    if (locked[0]?.dispatched_at && outcome.state === 'cancelled')
      outcome = { state: 'uncertain', errorCode: 'outcome_unknown' }
    if (outcome.state === 'cancelled' && current.error_code === 'cancelled_by_user')
      outcome = { state: 'cancelled', errorCode: 'cancelled_by_user' }
    if (persist && outcome.state === 'succeeded') {
      const persisted = await persist(tx)
      if (persisted) outcome = persisted
    }
    const result = outcome.state === 'succeeded' ? (outcome.result ?? {}) : null
    await tx
      .update(attempts)
      .set({
        state: outcome.state,
        result: result ?? sql`${attempts.result}`,
        errorCode: 'errorCode' in outcome ? (outcome.errorCode ?? null) : null,
        finishedAt: new Date(),
      })
      .where(eq(attempts.token, claim.token))
    await tx
      .update(operations)
      .set({
        state: sql`CASE WHEN ${operations.cancelRequested} AND ${outcome.state} IN ('retry_wait', 'failed', 'auth_required') THEN 'cancelled' ELSE ${outcome.state} END`,
        result,
        // The normalized children are durable in this same transaction; retain
        // only the receipt identity once the raw provider body is no longer needed.
        payload:
          claim.operation.kind === 'receive-webhook' &&
          ['succeeded', 'cancelled', 'superseded'].includes(outcome.state)
            ? null
            : sql`${operations.payload}`,
        remoteId:
          outcome.state === 'succeeded' && typeof outcome.result?.externalId === 'string'
            ? outcome.result.externalId
            : sql`${operations.remoteId}`,
        errorCode: 'errorCode' in outcome ? (outcome.errorCode ?? null) : null,
        leaseToken: null,
        leaseExpiresAt: null,
        dispatchedAt: ['failed', 'auth_required', 'retry_wait', 'succeeded'].includes(outcome.state)
          ? null
          : sql`${operations.dispatchedAt}`,
        version: sql`${operations.version} + 1`,
        updatedAt: new Date(),
        finishedAt: outcome.state === 'retry_wait' ? null : new Date(),
      })
      .where(eq(operations.id, claim.operation.id))
    return true
  })
}

function minimalRemoteEvidence(result?: Record<string, unknown>): Record<string, unknown> {
  return typeof result?.externalId === 'string' ? { externalId: result.externalId } : {}
}

/** A late result cannot resurrect private fields after source erasure. */
export async function recordRemoteEvidence(claim: SyncClaim, result: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(operations)
      .where(eq(operations.id, claim.operation.id))
      .for('update')
    if (!current) return
    await tx
      .update(attempts)
      .set({
        result: current.sourceRecordId && !current.payload ? minimalRemoteEvidence(result) : result,
        state: 'remote_succeeded',
        finishedAt: new Date(),
      })
      .where(eq(attempts.token, claim.token))
  })
}

/** Crashes before dispatch can retry. Crashes after dispatch may already have changed the platform. */
export async function recoverExpiredSyncs(): Promise<void> {
  await db.transaction(async (tx) => {
    const expired = await tx
      .select()
      .from(operations)
      .where(and(eq(operations.state, 'running'), sql`${operations.leaseExpiresAt} < now()`))
      .limit(100)
      .for('update', { skipLocked: true })
    for (const op of expired) {
      const state = op.dispatchedAt ? 'uncertain' : op.cancelRequested ? 'cancelled' : 'queued'
      await tx
        .update(operations)
        .set({
          state,
          finishedAt: state === 'queued' ? null : new Date(),
          errorCode: op.dispatchedAt ? 'outcome_unknown' : op.cancelRequested ? op.errorCode : null,
          leaseToken: null,
          leaseExpiresAt: null,
          version: op.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(operations.id, op.id))
      if (op.leaseToken)
        await tx
          .update(attempts)
          .set({
            state: 'interrupted',
            errorCode: op.dispatchedAt ? 'outcome_unknown' : null,
            finishedAt: new Date(),
          })
          .where(eq(attempts.token, op.leaseToken))
      if (state === 'queued') await enqueueSyncJob({ ...op, version: op.version + 1 }, tx)
    }
  })
}

/** The start boundary is recorded once by the schema migration, never by a worker. */
export async function requireSyncStart(executor: JobSqlExecutor) {
  const [start] = getExecuteRows<{ started_at: string }>(
    await executor.execute(sql`
    SELECT started_at FROM integration_sync_start WHERE id = 1 FOR SHARE`)
  )
  if (!start) throw new Error('Integration sync start boundary is unavailable')
  return start
}
