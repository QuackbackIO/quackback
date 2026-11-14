/**
 * The one way a frame reaches the shared inbox channel.
 *
 * Every inbox frame leaves with a scope envelope (inbox-envelope.ts) so the
 * stream can deliver it only to teammates whose scope holds the item. A
 * publisher that holds the item's owner and team passes them; one that holds
 * only an id gets them read here, one primary-key read per frame.
 *
 * Order. The frames for one item join a chain keyed by workspace, kind and id,
 * and each link awaits the previous link's NOTIFY (`publishAsync`, not the
 * fire-and-forget `publish`, which is one independent `pg_notify` per call).
 * So a frame waiting on its read never lets a later frame for the same item
 * overtake it. This orders frames within one process only, and a payload large
 * enough to spill to `realtime_overflow` is re-read asynchronously on receipt,
 * which can still reorder it; both are as before.
 *
 * Callers never wait: the publish stays fire-and-forget, and a failed read or
 * NOTIFY goes to a warn log and never blocks the next link. A frame with no
 * item, or whose row is gone and no envelope was passed, is dropped: the
 * stream would drop a frame without an envelope anyway.
 */
import { publishAsync } from './pubsub'
import { readInboxItemScope } from './inbox-scope-read'
import type { InboxItemScope } from './inbox-envelope'
import type { InboxItemRef } from '@/lib/shared/inbox/items'
import { currentWorkspaceNamespace } from '../workspaces/workspace-keyed'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'inbox-publish' })

/** Single shared channel all agents listen on for inbox-wide updates. */
export const CONVERSATION_INBOX_CHANNEL = 'conversation:inbox'

/** Chain tails by `(workspace, kind, id)`; an entry leaves when its tail settles. */
const chains = new Map<string, Promise<void>>()

/**
 * Publish `payload` on the inbox channel for one item. `scope` is the item's
 * owner and team when the caller holds them; without it they are read by id.
 */
export function publishInboxFrame(
  ref: InboxItemRef | null,
  payload: unknown,
  scope?: InboxItemScope
): void {
  if (!ref) {
    log.warn(
      { kind: (payload as { kind?: unknown } | null)?.kind },
      'inbox frame names no item; dropped'
    )
    return
  }
  // Taken now, in the caller's scope, so the chain slot cannot depend on
  // whichever request happens to be current when the link runs.
  let namespace: string
  try {
    namespace = currentWorkspaceNamespace()
  } catch (err) {
    log.warn({ err, item_kind: ref.kind }, 'inbox frame outside a workspace; dropped')
    return
  }
  const key = `${namespace}\u0000${ref.kind}\u0000${ref.id}`

  const send = async (): Promise<void> => {
    let resolved: InboxItemScope | null
    try {
      resolved = scope ?? (await readInboxItemScope(ref))
    } catch (err) {
      log.warn({ err, item_kind: ref.kind, item_id: ref.id }, 'inbox frame scope read failed')
      return
    }
    if (!resolved) {
      log.warn({ item_kind: ref.kind, item_id: ref.id }, 'inbox frame item not found; dropped')
      return
    }
    try {
      await publishAsync(CONVERSATION_INBOX_CHANNEL, payload, { ...ref, ...resolved })
    } catch (err) {
      log.warn({ err, item_kind: ref.kind, item_id: ref.id }, 'inbox publish failed')
    }
  }

  const previous = chains.get(key) ?? Promise.resolve()
  const tail = previous.then(send)
  chains.set(key, tail)
  void tail.finally(() => {
    if (chains.get(key) === tail) chains.delete(key)
  })
}

/** Test seam: resolves once every inbox frame published so far has been sent or dropped. */
export async function inboxPublishesSettled(): Promise<void> {
  while (chains.size > 0) await Promise.all([...chains.values()])
}
