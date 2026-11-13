/**
 * Which messages count as a teammate's reply: the one rule the response clocks
 * (`domains/sla/sla.messages.ts`, `sla.event-hooks.ts`) and a ticket's first
 * response (`domains/tickets/ticket-first-response.ts`) share.
 *
 * A human reply is a public agent message from anyone but an automated
 * service principal. The assistant, workflow blocks and workspace API keys
 * write as service principals, so their replies never count. A personal API
 * key acts as its creator: its reply, written through the REST API under the
 * key's own service principal, counts as that teammate's reply. That holds for
 * every personal key, revoked or not and whether or not its creator is still
 * known, because the rule reads the message's principal and never the key's
 * creator. A message with no principal is not a service's.
 *
 * Callers add their own filters: public (`is_internal = false`), and for a
 * ticket's first response, not deleted.
 */
import { and, db, eq, or, sql, apiKeys, conversationMessages, principal } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'

/**
 * Service principals that write automated replies: every service principal
 * except a personal API key's. Two membership tests against small sets rather
 * than a join: a join lets the planner hash the whole principal table for a
 * long conversation, whatever the time bound.
 */
function automatedPrincipal(id: unknown) {
  return sql`(${id} in (select ${principal.id} from ${principal} where ${principal.type} = 'service')
    and ${id} not in (select ${apiKeys.principalId} from ${apiKeys} where ${apiKeys.kind} = 'personal'))`
}

/** Whether the message's author is an automated service principal. */
export const byService = sql`coalesce(${automatedPrincipal(conversationMessages.principalId)}, false)`

/** A public-or-not agent message from a teammate (callers add `is_internal = false`). */
export const humanReply = and(eq(conversationMessages.senderType, 'agent'), sql`not ${byService}`)!

/**
 * A message that opens a next-response cycle: a visitor's, or an automated
 * service's reply.
 */
export const cycleOpener = or(
  eq(conversationMessages.senderType, 'visitor'),
  and(eq(conversationMessages.senderType, 'agent'), byService)
)!

/**
 * The same rule for one principal, read from the database: true when a
 * message written by `principalId` is an automated service's. An event's
 * reaction uses it on the message's author, so the reaction and the message
 * rows agree.
 */
export async function isAutomatedAuthor(principalId: PrincipalId | null): Promise<boolean> {
  if (!principalId) return false
  const [row] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(and(eq(principal.id, principalId), automatedPrincipal(principal.id)))
    .limit(1)
  return row !== undefined
}
