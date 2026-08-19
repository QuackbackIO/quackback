/**
 * Reader-biased authority for Quinn. Autonomous turns can inspect and reply to
 * conversations, publish team-only pending-action notices, record conversation
 * attributes (metadata facts learned while talking to the customer), and raise
 * tickets (capturing a reported problem for a teammate to investigate is the
 * support agent's core job), but cannot close conversations or publish on a
 * customer's behalf. Approved actions execute under the approving teammate's
 * actor.
 *
 * The explicit ceiling cannot silently widen as the admin role grows.
 */
import type { Actor } from '@/lib/server/policy/types'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

/**
 * The bounded authority Quinn acts with autonomously.
 */
export const ASSISTANT_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_VIEW_ALL,
  PERMISSIONS.CONVERSATION_REPLY,
  // Pending-action proposal and expiry notices are fixed, team-only messages;
  // no model-facing tool exposes arbitrary ticket-note writes.
  PERMISSIONS.TICKET_NOTE,
  // set_attribute records facts Quinn learns mid-conversation (issue type,
  // plan tier) against the admin-defined catalogue. It is reporting metadata
  // with AI-precedence rules (a human-set value always wins) and runs entirely
  // server-side — the customer never sees the tool call — so it sits inside
  // Quinn's autonomous remit, unlike the still-gated workflow writes.
  PERMISSIONS.CONVERSATION_SET_ATTRIBUTES,
  // create_ticket turns a reported bug or account problem into work for a
  // teammate — the escalation artifact this surface exists to produce. It
  // creates internal work, never acts outward: a spurious ticket is cheap to
  // close, and the write-tool idempotency key already prevents duplicates for
  // the same customer message.
  PERMISSIONS.TICKET_CREATE,
])

export function quinnActor(principalId: PrincipalId): Actor {
  return boundedServiceActor(ASSISTANT_PERMISSIONS, principalId)
}
