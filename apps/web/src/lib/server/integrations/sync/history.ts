import { SyncRequestError } from './errors'
import {
  db,
  eq,
  and,
  desc,
  postExternalLinks,
  sql,
  integrationSyncOperations as operations,
  integrationSyncAttempts as attempts,
  integrationSyncActions as actions,
} from '@/lib/server/db'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  SYNC_ERRORS,
  type SyncAction,
  type SyncFilter,
  type SyncHistoryItem,
  type SyncState,
  type SyncErrorCode,
} from '@/lib/shared/integration-sync'
import { syncSourceForActor, currentSyncIntegration } from './eligibility'
import { enqueueSyncJob, readSyncPayload } from './ledger'
import { encrypt } from '@/lib/server/encryption'
import type { SyncOperation } from './types'
import { randomUUID } from 'node:crypto'
import { getIntegration } from '../index'
import { safeDestinationLabel } from '../destination'
import { inspectSyncRemote } from './remote'
import { persistSyncLink } from './hooks'
import { getBaseUrl } from '@/lib/server/config'
import { absolutizeMarkdownUrls } from '../post-content'

export function syncActions(
  op: Pick<SyncOperation, 'state' | 'cancelRequested'> &
    Partial<Pick<SyncOperation, 'provider' | 'kind' | 'sourceType'>>,
  manage: boolean
): SyncAction[] {
  if (!manage) return []
  const link: SyncAction[] =
    op.kind === 'create' &&
    ['post', 'ticket'].includes(op.sourceType ?? '') &&
    getIntegration(op.provider ?? '')?.issues?.inspect
      ? ['link_existing']
      : []
  if (op.state === 'uncertain')
    return [
      ...(op.cancelRequested ? ['reconcile' as const] : ['reconcile' as const, 'cancel' as const]),
      ...link,
    ]
  if (op.state === 'conflict') return ['keep_remote', 'cancel', ...link]
  if (op.state === 'failed' || op.state === 'auth_required') return ['retry', 'cancel']
  if (['queued', 'retry_wait', 'running'].includes(op.state) && !op.cancelRequested)
    return ['cancel']
  return []
}

function safeRemoteUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

function destinationLabel(op: SyncOperation): string | null {
  const label = getIntegration(op.provider)?.destination?.label
  if (!op.payload || !label) return null
  const data = readSyncPayload(op).data
  const inbound = data.result as { destinationId?: unknown } | undefined
  const value = label(data.target ?? { channelId: inbound?.destinationId })
  // Provider metadata cannot opt URL credentials or arbitrary payload data into history.
  return safeDestinationLabel(value)
}

async function present(op: SyncOperation, actor: Actor): Promise<SyncHistoryItem> {
  const source = await syncSourceForActor(op, actor)
  let remote = op.result
  // Soft-deleted feedback retains its explicit archive selection, not its old content.
  if (source && op.kind === 'archive' && op.payload) {
    const linkId = readSyncPayload(op).data.linkId
    if (typeof linkId === 'string') {
      const link = await db.query.postExternalLinks.findFirst({
        where: and(
          eq(postExternalLinks.id, linkId as never),
          eq(postExternalLinks.postId, op.sourceId as never),
          eq(postExternalLinks.integrationId, op.integrationId as never),
          eq(postExternalLinks.externalId, op.remoteId ?? '')
        ),
      })
      if (link)
        remote = { externalUrl: link.externalUrl, externalDisplayId: link.externalDisplayId }
    }
  }
  return {
    id: op.id,
    provider: op.provider,
    direction: op.direction as 'inbound' | 'outbound',
    kind: op.kind,
    state: op.state as SyncState,
    version: op.version,
    sourceType: op.sourceType,
    sourceId: source && ['post', 'ticket'].includes(op.sourceType) ? source.id : null,
    sourceTitle: source?.title ?? null,
    destinationLabel: source ? destinationLabel(op) : null,
    remoteUrl: source ? safeRemoteUrl(remote?.externalUrl) : null,
    remoteDisplayId:
      source && typeof remote?.externalDisplayId === 'string' ? remote.externalDisplayId : null,
    attempts: op.attempts,
    error: op.errorCode
      ? (SYNC_ERRORS[op.errorCode as SyncErrorCode] ?? 'This sync needs attention.')
      : null,
    cancelRequested: op.cancelRequested,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
    actions: syncActions(op, !!source && can(actor, PERMISSIONS.INTEGRATION_MANAGE)),
  }
}

export async function listSyncHistory(
  input: { provider: string; filter: SyncFilter; cursor?: { at: string; id: string } },
  actor: Actor
) {
  const stateFilter =
    input.filter === 'attention'
      ? sql`${operations.state} IN ('failed','auth_required','uncertain','conflict')`
      : input.filter === 'progress'
        ? sql`${operations.state} IN ('queued','running','retry_wait')`
        : input.filter === 'successful'
          ? eq(operations.state, 'succeeded')
          : undefined
  const rows = await db
    .select()
    .from(operations)
    .where(
      and(
        eq(operations.provider, input.provider),
        stateFilter,
        sql`(${operations.createdAt} > now() - interval '90 days' OR ${operations.state} IN ('queued','running','retry_wait','failed','auth_required','uncertain','conflict'))`,
        input.cursor
          ? sql`(${operations.createdAt}, ${operations.id}) < (${input.cursor.at}::timestamptz, ${input.cursor.id}::uuid)`
          : undefined
      )
    )
    .orderBy(desc(operations.createdAt), desc(operations.id))
    .limit(26)
  const page = rows.slice(0, 25)
  const items: SyncHistoryItem[] = []
  for (let start = 0; start < page.length; start += 5)
    items.push(...(await Promise.all(page.slice(start, start + 5).map((op) => present(op, actor)))))
  const last = page.at(-1)
  return {
    items,
    nextCursor: rows.length > 25 && last ? { at: last.createdAt.toISOString(), id: last.id } : null,
  }
}

async function authorizedOperation(id: string, actor: Actor) {
  const op = await db.query.integrationSyncOperations.findFirst({ where: eq(operations.id, id) })
  if (!op || !(await syncSourceForActor(op, actor)))
    throw new SyncRequestError('Sync item unavailable')
  return op
}

export async function inspectSyncOperation(id: string, actor: Actor) {
  const op = await authorizedOperation(id, actor)
  const history = await db
    .select({
      id: attempts.id,
      number: attempts.number,
      state: attempts.state,
      errorCode: attempts.errorCode,
      startedAt: attempts.startedAt,
      finishedAt: attempts.finishedAt,
    })
    .from(attempts)
    .where(eq(attempts.operationId, id))
    .orderBy(desc(attempts.number))
    .limit(50)
  let preview: { title: string; content: string } | null = null
  if (op.payload && op.state === 'conflict') {
    const payload = readSyncPayload(op)
    const post = (
      payload.data.event as { data?: { post?: { title?: string; content?: string } } } | undefined
    )?.data?.post
    if (post)
      preview = {
        title: post.title ?? '',
        // Keep the full Markdown proposal intact when copied to another platform.
        content:
          getIntegration(op.provider)?.formatReviewContent?.(post.content ?? '', getBaseUrl()) ??
          absolutizeMarkdownUrls(post.content ?? '', getBaseUrl(), false),
      }
    if (typeof payload.data.proposedStatus === 'string')
      preview = { title: 'Proposed status', content: payload.data.proposedStatus }
    const inbound = payload.data.result as { externalStatus?: unknown } | undefined
    if (op.direction === 'inbound' && typeof inbound?.externalStatus === 'string')
      preview = { title: 'Platform status', content: inbound.externalStatus }
  }
  let remote: { title: string; content: string; externalUrl: string | null } | null = null
  if (op.state === 'conflict' && op.remoteId && getIntegration(op.provider)?.issues?.inspect) {
    try {
      const item = await inspectSyncRemote(op, op.remoteId)
      remote = {
        title: item.title,
        content: item.content,
        externalUrl: safeRemoteUrl(item.externalUrl),
      }
    } catch {
      /* The saved source remains available when the provider cannot be reached. */
    }
  }
  return {
    item: await present(op, actor),
    preview,
    remote,
    attempts: history.map((a) => ({
      ...a,
      error: a.errorCode ? (SYNC_ERRORS[a.errorCode as SyncErrorCode] ?? 'Sync interrupted') : null,
      startedAt: a.startedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
    })),
  }
}

export async function verifySyncReference(id: string, reference: string, actor: Actor) {
  if (!can(actor, PERMISSIONS.INTEGRATION_MANAGE)) throw new SyncRequestError('Not permitted')
  const op = await authorizedOperation(id, actor)
  if (!syncActions(op, true).includes('link_existing'))
    throw new SyncRequestError('This action is no longer available')
  const remote = await inspectSyncRemote(op, reference)
  return {
    title: remote.title,
    externalId: remote.externalId,
    externalDisplayId: remote.externalDisplayId,
    externalUrl: safeRemoteUrl(remote.externalUrl),
  }
}

export async function actOnSync(
  input: {
    id: string
    version: number
    actionId: string
    action: SyncAction
    reference?: string
    expectedRemoteId?: string
  },
  actor: Actor
) {
  if (!can(actor, PERMISSIONS.INTEGRATION_MANAGE) || !actor.principalId)
    throw new SyncRequestError('Not permitted')
  const op = await authorizedOperation(input.id, actor)
  if (
    ['retry', 'reconcile', 'link_existing'].includes(input.action) &&
    !(await currentSyncIntegration(op))
  )
    throw new SyncRequestError(
      'The original connection is unavailable. Review the remote item directly; this request cannot run on a replacement connection.'
    )
  const verified =
    input.action === 'link_existing' && input.reference
      ? await inspectSyncRemote(op, input.reference)
      : null
  if (
    input.action === 'link_existing' &&
    (!verified || verified.externalId !== input.expectedRemoteId)
  )
    throw new SyncRequestError('Inspect and confirm the remote item first')
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM integration_sync_operations WHERE id = ${input.id}::uuid FOR UPDATE`
    )
    const prior = await tx.query.integrationSyncActions.findFirst({
      where: eq(actions.id, input.actionId),
    })
    if (prior) {
      if (
        prior.operationId !== input.id ||
        prior.principalId !== actor.principalId ||
        prior.action !== input.action
      )
        throw new SyncRequestError('Invalid recovery request')
      return { success: true }
    }
    const current = await tx.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, input.id),
    })
    if (!current || current.version !== input.version)
      throw new SyncRequestError('This sync changed. Refresh and try again.')
    if (!syncActions(current, true).includes(input.action))
      throw new SyncRequestError('This action is no longer available')
    await tx.insert(actions).values({
      id: input.actionId,
      operationId: input.id,
      action: input.action,
      principalId: actor.principalId!,
    })
    if (input.action === 'link_existing' && verified) {
      const result = {
        externalId: verified.externalId,
        externalUrl: verified.externalUrl,
        externalDisplayId: verified.externalDisplayId,
      }
      await persistSyncLink(tx, { operation: current, token: randomUUID() }, result)
      await tx.insert(attempts).values({
        operationId: current.id,
        number: current.attempts + 1,
        token: randomUUID(),
        state: 'manually_verified',
        result,
        finishedAt: new Date(),
      })
      await tx
        .update(operations)
        .set({
          state: 'succeeded',
          result,
          remoteId: verified.externalId,
          errorCode: null,
          dispatchedAt: null,
          attempts: current.attempts + 1,
          version: current.version + 1,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(operations.id, current.id))
    } else if (input.action === 'cancel' || input.action === 'keep_remote') {
      await tx
        .update(operations)
        .set({
          cancelRequested: true,
          ...(input.action === 'cancel' ? { errorCode: 'cancelled_by_user' } : {}),
          state:
            current.state === 'running' || current.state === 'uncertain'
              ? current.state
              : input.action === 'keep_remote'
                ? 'superseded'
                : 'cancelled',
          version: current.version + 1,
          updatedAt: new Date(),
          finishedAt: ['running', 'uncertain'].includes(current.state) ? null : new Date(),
        })
        .where(eq(operations.id, input.id))
    } else {
      if (!current.payload) throw new SyncRequestError('The original data is no longer available')
      const payload = readSyncPayload(current)
      payload.reconcileOnly = input.action === 'reconcile'
      await tx
        .update(operations)
        .set({
          state: 'queued',
          cancelRequested: false,
          errorCode: null,
          finishedAt: null,
          dispatchedAt: input.action === 'reconcile' ? current.dispatchedAt : null,
          payload: encrypt(JSON.stringify(payload), 'integration-sync-payload'),
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(operations.id, input.id))
      await enqueueSyncJob({ ...current, version: current.version + 1 }, tx)
    }
    return { success: true }
  })
  return result
}
