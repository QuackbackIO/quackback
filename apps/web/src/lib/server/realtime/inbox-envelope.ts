/**
 * The scope envelope an inbox frame carries on the pubsub wire.
 *
 * The inbox stream filters every frame against each subscriber's scope, so it
 * must know the item's kind, owner and team without parsing the payload. That
 * data rides beside the payload as the wire envelope's `s` field (pubsub.ts
 * carries it as opaque `meta`), never inside it: the stream forwards the
 * payload string untouched, so neither an in-scope teammate nor a visitor
 * ever receives an owner, a team or a previous assignee they were not already
 * shown. Only the inbox publish sets it (inbox-publish.ts); a visitor or
 * per-item channel frame never carries one.
 *
 * `prev` is set by a write that can move an item out of someone's scope. The
 * stream then sends a removal to a subscriber who held the item and no longer
 * does.
 */
import type { ScopedRow } from '@/lib/server/policy/row-scope'
import type { InboxItemRef } from '@/lib/shared/inbox/items'

/** An item's owner and team now, and before the write when it can move the item. */
export type InboxItemScope = ScopedRow & { prev?: ScopedRow }

/** The wire envelope: which item, and its scope. */
export type InboxScopeEnvelope = InboxItemRef & InboxItemScope

/**
 * Narrow pubsub's opaque `meta` to an inbox envelope, or undefined when it is
 * missing or malformed (which the stream treats as no envelope: dropped).
 */
export function asInboxEnvelope(meta: unknown): InboxScopeEnvelope | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const m = meta as Partial<InboxScopeEnvelope>
  if ((m.kind !== 'conversation' && m.kind !== 'ticket') || typeof m.id !== 'string') {
    return undefined
  }
  return m as InboxScopeEnvelope
}
