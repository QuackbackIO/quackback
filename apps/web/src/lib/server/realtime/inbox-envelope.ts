/**
 * The scope envelope an inbox frame carries on the pubsub wire.
 *
 * The inbox stream filters every frame against each subscriber's scope, so it
 * must know the item's kind, owner and team without parsing the payload. That
 * data rides beside the payload as the wire envelope's `s` field
 * (pubsub.ts), never inside it: the stream forwards the payload string
 * untouched, so neither an in-scope teammate nor a visitor ever receives an
 * owner, a team or a previous assignee they were not already shown. Only the
 * inbox publish sets it (inbox-publish.ts); a visitor or per-item channel
 * frame never carries one.
 *
 * `prev*` is set (both keys, values may be null) by a write that can move an
 * item out of someone's scope. The stream then sends a removal to a
 * subscriber who held the item and no longer does.
 */
export interface InboxScopeEnvelope {
  kind: 'conversation' | 'ticket'
  /** The item id, which the removal frame names. */
  id: string
  assigneePrincipalId: string | null
  teamId: string | null
  prevAssigneePrincipalId?: string | null
  prevTeamId?: string | null
}

/** The owner and team an item had before a write moved it. */
export interface InboxScopePrev {
  assigneePrincipalId: string | null
  teamId: string | null
}

/**
 * What a publisher may pass for an inbox frame: the item's current owner and
 * team, and, from a write that can take the item out of someone's scope, what
 * they were before it.
 */
export interface InboxItemScope {
  assigneePrincipalId: string | null
  teamId: string | null
  prev?: InboxScopePrev
}

/** Whether a write said what the item's owner and team were before it. */
export function hasPrev(s: InboxScopeEnvelope): boolean {
  return 'prevAssigneePrincipalId' in s || 'prevTeamId' in s
}
