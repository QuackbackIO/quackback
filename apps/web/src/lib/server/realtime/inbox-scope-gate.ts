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
 * - The cache is reloaded lazily: a frame that arrives more than the TTL after
 *   the last load, or after a scope-changed signal, waits for a reload first.
 *   Idle streams run no queries. The TTL is jittered below `ttlMs` per load,
 *   so streams opened together do not reload in lockstep.
 * - While a reload runs, frames queue behind it in arrival order. A reload
 *   that fails, or does not answer within `reloadTimeoutMs`, drops the queued
 *   frames (fail closed) and the next frame retries.
 * - A reload that finds the principal is no longer a teammate closes the
 *   stream: the inbox gate at connect is otherwise never asked again.
 * - A scope-changed signal also sends one `inbox_scope_changed` event, so the
 *   client refetches lists the new scope changes.
 */
import type { PermissionKey } from '@/lib/shared/permissions'
import { rowInScope, SCOPE_VIEW_KEYS } from '@/lib/server/policy/row-scope'
import type { Actor } from '@/lib/server/policy/types'
import { asInboxEnvelope, type InboxScopeEnvelope } from './inbox-envelope'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'inbox-scope-gate' })

/** The most a cached scope is trusted without a reload. */
export const INBOX_SCOPE_TTL_MS = 60_000

/** How long a reload may take before the frames behind it are dropped. */
export const INBOX_SCOPE_RELOAD_TIMEOUT_MS = 10_000

/** The share of the TTL taken off at random per load. */
const TTL_JITTER = 0.2

export interface InboxScopeSnapshot {
  permissions: ReadonlySet<PermissionKey>
  teamIds: ReadonlySet<string>
}

/** A reload's answer: the fresh scope, or `'not-teammate'` to close the stream. */
export type InboxScopeLoad = InboxScopeSnapshot | 'not-teammate'

export interface InboxScopeGateOptions {
  /** The stream's actor, as resolved at connect. Its keys are the initial scope. */
  actor: Actor
  /** The teammate's team ids, as read at connect. */
  teamIds: ReadonlySet<string>
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
  random?: () => number
  ttlMs?: number
  reloadTimeoutMs?: number
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
  // The only keys the scope rule reads, so the cache holds nothing else.
  return new Set(SCOPE_VIEW_KEYS.filter((k) => permissions.has(k)))
}

export function createInboxScopeGate(opts: InboxScopeGateOptions): InboxScopeGate {
  const now = opts.now ?? Date.now
  const random = opts.random ?? Math.random
  const ttlMs = opts.ttlMs ?? INBOX_SCOPE_TTL_MS
  const reloadTimeoutMs = opts.reloadTimeoutMs ?? INBOX_SCOPE_RELOAD_TIMEOUT_MS
  const principalId = opts.actor.principalId
  // Rebuilt once per successful load, never per frame.
  const scopedActor = (permissions: ReadonlySet<PermissionKey>): Actor => ({
    ...opts.actor,
    permissions: onlyInboxViewKeys(permissions),
  })
  let actor = scopedActor(opts.actor.permissions ?? new Set())
  let teamIds = opts.teamIds
  const nextExpiry = () => now() + ttlMs * (1 - TTL_JITTER * random())
  let expiresAt = nextExpiry()
  // Set by a scope-changed signal or a failed reload; a reload clears it when
  // it starts, so one that finds it set again when it ends reads again.
  let stale = false
  let reloading = false
  let closed = false
  const queue: Queued[] = []

  const deliver = (item: Queued): void => {
    if (item.type === 'changed') {
      opts.sendEvent('inbox_scope_changed', { kind: 'inbox_scope_changed' })
      return
    }
    const s = item.scope
    if (!s) {
      log.warn({ principal_id: principalId }, 'inbox frame without a scope envelope; dropped')
      return
    }
    if (rowInScope(actor, s.kind, s, teamIds)) {
      opts.forward(item.message)
      return
    }
    if (s.prev && rowInScope(actor, s.kind, s.prev, teamIds)) {
      opts.sendEvent('inbox_item_removed', {
        kind: 'inbox_item_removed',
        itemKind: s.kind,
        id: s.id,
      })
    }
  }

  /** Run one load, or give up after the timeout. Undefined means it failed. */
  const loadOnce = async (): Promise<InboxScopeLoad | undefined> => {
    let result: InboxScopeLoad | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), reloadTimeoutMs)
    })
    const run = opts
      .runReload(async () => {
        result = await opts.load()
      })
      .then(() => 'done' as const)
      .catch((err: unknown) => {
        log.warn({ err, principal_id: principalId }, 'inbox scope reload failed')
        return 'done' as const
      })
    const outcome = await Promise.race([run, timedOut])
    clearTimeout(timer)
    if (outcome === 'timeout') {
      log.warn(
        { principal_id: principalId, timeout_ms: reloadTimeoutMs },
        'inbox scope reload timed out'
      )
      return undefined
    }
    return result
  }

  const reload = async (): Promise<void> => {
    reloading = true
    stale = false
    const result = await loadOnce()
    if (closed) return
    if (result === 'not-teammate') {
      closed = true
      queue.length = 0
      log.info({ principal_id: principalId }, 'inbox stream closed: no longer a teammate')
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
          { principal_id: principalId, dropped },
          'inbox scope unknown after a failed reload; queued frames dropped'
        )
      }
      for (const item of queue.splice(0)) if (item.type === 'changed') deliver(item)
      stale = true
      reloading = false
      return
    }
    actor = scopedActor(result.permissions)
    teamIds = result.teamIds
    expiresAt = nextExpiry()
    if (stale) {
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
    if (stale || now() > expiresAt) {
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
      accept({ type: 'changed' })
    },
  }
}
