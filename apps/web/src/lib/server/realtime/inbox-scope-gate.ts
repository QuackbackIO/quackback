/**
 * The inbox stream's per-subscriber scope filter.
 *
 * Every teammate's inbox stream hears every frame on the shared inbox channel.
 * The gate passes a frame on only when the subscriber's scope holds the item,
 * judged by `rowInScope` against the frame's wire envelope (inbox-envelope.ts)
 * and a cached copy of the subscriber's scope: their four inbox view keys and
 * their team ids.
 *
 * - A frame without an envelope is dropped. Every inbox publish sets one, so
 *   a frame without it came from code that skipped the scope check.
 * - A frame whose envelope names previous owner and team, for an item the
 *   subscriber held before and does not now, becomes an `inbox_item_removed`
 *   event instead, so the row leaves their list.
 * - The cache is reloaded lazily: a frame that arrives more than `ttlMs` after
 *   the last load, or after a scope-changed signal, waits for a reload first.
 *   Idle streams run no queries.
 * - While a reload runs, frames queue behind it in arrival order. A failed
 *   reload drops the queued frames (fail closed) and the next frame retries.
 * - A reload that finds the principal is no longer a teammate closes the
 *   stream: the inbox gate at connect is otherwise never asked again.
 * - A scope-changed signal also sends one `inbox_scope_changed` event, so the
 *   client refetches lists the new scope changes.
 */
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { rowInScope } from '@/lib/server/policy/row-scope'
import type { Actor } from '@/lib/server/policy/types'
import { asInboxEnvelope, type InboxScopeEnvelope } from './inbox-envelope'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'inbox-scope-gate' })

/** How long a cached scope is trusted without a reload. */
export const INBOX_SCOPE_TTL_MS = 60_000

/** The only keys the scope rule reads, so the cache holds nothing else. */
const INBOX_VIEW_KEYS: readonly PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_VIEW_ALL,
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.TICKET_VIEW_ALL,
]

export interface InboxScopeSnapshot {
  permissions: ReadonlySet<PermissionKey>
  teamIds: ReadonlySet<string>
}

/** A reload's answer: the fresh scope, or `'not-teammate'` to close the stream. */
export type InboxScopeLoad = InboxScopeSnapshot | 'not-teammate'

export interface InboxScopeGateOptions {
  principalId: PrincipalId
  initial: InboxScopeSnapshot
  /** Read the subscriber's scope afresh. May throw. */
  load: () => Promise<InboxScopeLoad>
  /**
   * Run the reload body where the database is reachable. Pubsub callbacks run
   * outside the request scope, so the stream passes its `withLivePool`. It may
   * swallow the body's error; the gate learns of a failure from the missing
   * result, not from a throw.
   */
  runReload: (body: () => Promise<void>) => Promise<void>
  /** Pass a frame's raw payload on to the client unchanged. */
  forward: (message: string) => void
  /** Send an event the gate builds itself. */
  sendEvent: (name: 'inbox_item_removed' | 'inbox_scope_changed', data: unknown) => void
  /** End the stream. */
  close: () => void
  now?: () => number
  ttlMs?: number
}

type Queued = { type: 'frame'; message: string; scope?: InboxScopeEnvelope } | { type: 'changed' }

export interface InboxScopeGate {
  /** A frame from the shared inbox channel, with pubsub's opaque metadata. */
  onInboxFrame: (message: string, meta?: unknown) => void
  /** The subscriber's role or teams changed: reload now and tell the client. */
  onScopeChanged: () => void
}

export function onlyInboxViewKeys(
  permissions: ReadonlySet<PermissionKey>
): ReadonlySet<PermissionKey> {
  return new Set(INBOX_VIEW_KEYS.filter((k) => permissions.has(k)))
}

export function createInboxScopeGate(opts: InboxScopeGateOptions): InboxScopeGate {
  const now = opts.now ?? Date.now
  const ttlMs = opts.ttlMs ?? INBOX_SCOPE_TTL_MS
  let scope: InboxScopeSnapshot = {
    permissions: onlyInboxViewKeys(opts.initial.permissions),
    teamIds: opts.initial.teamIds,
  }
  let loadedAt = now()
  let stale = false
  let reloading = false
  let reloadAgain = false
  let closed = false
  const queue: Queued[] = []

  const actorFor = (): Actor => ({
    principalId: opts.principalId,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: scope.permissions,
  })

  const deliver = (item: Queued): void => {
    if (item.type === 'changed') {
      opts.sendEvent('inbox_scope_changed', { kind: 'inbox_scope_changed' })
      return
    }
    const s = item.scope
    if (!s) {
      log.warn({ principal_id: opts.principalId }, 'inbox frame without a scope envelope; dropped')
      return
    }
    const actor = actorFor()
    const current = { assigneePrincipalId: s.assigneePrincipalId, teamId: s.teamId }
    if (rowInScope(actor, s.kind, current, scope.teamIds)) {
      opts.forward(item.message)
      return
    }
    if (s.prev && rowInScope(actor, s.kind, s.prev, scope.teamIds)) {
      opts.sendEvent('inbox_item_removed', {
        kind: 'inbox_item_removed',
        itemKind: s.kind,
        id: s.id,
      })
    }
  }

  const reload = async (): Promise<void> => {
    reloading = true
    reloadAgain = false
    let result: InboxScopeLoad | undefined
    try {
      await opts.runReload(async () => {
        result = await opts.load()
      })
    } catch (err) {
      log.warn({ err, principal_id: opts.principalId }, 'inbox scope reload failed')
    }
    if (closed) return
    if (result === 'not-teammate') {
      closed = true
      queue.length = 0
      log.info({ principal_id: opts.principalId }, 'inbox stream closed: no longer a teammate')
      opts.close()
      return
    }
    if (result === undefined) {
      // Fail closed: what the scope now is cannot be known, so nothing that
      // waited on it is sent. A scope-changed notice carries no item data and
      // still goes out. The next frame tries again.
      const dropped = queue.filter((q) => q.type === 'frame').length
      if (dropped > 0) {
        log.warn(
          { principal_id: opts.principalId, dropped },
          'inbox scope unknown after a failed reload; queued frames dropped'
        )
      }
      for (const item of queue.splice(0)) if (item.type === 'changed') deliver(item)
      stale = true
      reloading = false
      return
    }
    scope = { permissions: onlyInboxViewKeys(result.permissions), teamIds: result.teamIds }
    loadedAt = now()
    stale = false
    if (reloadAgain) {
      // A change landed while this reload read: its rows may predate it.
      void reload()
      return
    }
    reloading = false
    for (const item of queue.splice(0)) deliver(item)
  }

  const accept = (item: Queued): void => {
    if (closed) return
    if (reloading) {
      queue.push(item)
      return
    }
    if (stale || now() - loadedAt > ttlMs) {
      queue.push(item)
      void reload()
      return
    }
    deliver(item)
  }

  return {
    onInboxFrame: (message, meta) =>
      accept({ type: 'frame', message, scope: asInboxEnvelope(meta) }),
    onScopeChanged: () => {
      if (closed) return
      stale = true
      if (reloading) reloadAgain = true
      accept({ type: 'changed' })
    },
  }
}
