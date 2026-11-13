/**
 * Which messages count as a teammate's reply: the one rule the response clocks
 * (`domains/sla/sla.messages.ts`, `sla.event-hooks.ts`) and a ticket's first
 * response (`domains/tickets/ticket-first-response.ts`) share.
 *
 * A human reply is a public agent message from anyone but an automated
 * service principal. The assistant, workflow blocks and workspace API keys
 * write as service principals, so their replies never count. A personal API
 * key made from the release that records the personal-key cutoff on (the
 * migration `0312_personal_key_reply_cutoff`) acts as its creator: its reply,
 * written through the REST API under the key's own service principal, counts
 * as that teammate's reply, revoked or not and whether or not its creator is
 * still known, because the rule reads the message's principal and never the
 * key's creator. A personal key made before the cutoff stays automated: keys
 * older than key kinds were all marked personal, and integrations built on
 * them expect their replies to stay automated. With no cutoff recorded, every
 * key is automated. A message with no principal is not a service's.
 *
 * Callers add their own filters: public (`is_internal = false`), and for a
 * ticket's first response, not deleted.
 */
import { and, db, eq, or, sql, apiKeys, conversationMessages, principal } from '@/lib/server/db'
import type { SQLWrapper } from 'drizzle-orm'
import { toUuid, type PrincipalId } from '@quackback/ids'

/** The kv key the migration records the personal-key cutoff under. */
export const PERSONAL_KEY_REPLY_CUTOFF_KEY = 'api-keys:personal-reply-cutoff'

/**
 * When this database reached the release that counts personal-key replies as
 * people's. Each workspace has its own database, so the row is matched by key
 * alone. Null when no cutoff is recorded.
 */
const personalKeyCutoff = sql`(select min((value #>> '{}')::timestamptz) from kv_store
  where key = ${PERSONAL_KEY_REPLY_CUTOFF_KEY} and expires_at > now())`

/**
 * Service principals that write automated replies: every service principal
 * except a personal API key's made at or after the cutoff. Two membership
 * tests against small sets rather than a join: a join lets the planner hash
 * the whole principal table for a long conversation, whatever the time bound.
 * With no cutoff, `created_at >= null` matches no key, so every key is
 * automated.
 */
function automatedPrincipal(id: SQLWrapper) {
  return sql`(${id} in (select ${principal.id} from ${principal} where ${principal.type} = 'service')
    and ${id} not in (select ${apiKeys.principalId} from ${apiKeys}
      where ${apiKeys.kind} = 'personal' and ${apiKeys.createdAt} >= ${personalKeyCutoff}))`
}

/** Whether the message's author is an automated service principal. */
export const byService = sql`coalesce(${automatedPrincipal(conversationMessages.principalId)}, false)`

/** An agent message from a teammate. Callers add `is_internal = false` for a public reply. */
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
 * Whether a key acting as `id` replies as a person: a personal key made at or
 * after the cutoff. Any other key (a workspace key, or a personal key from
 * before the cutoff) is automated, whatever kind of principal it acts as.
 */
function keyRepliesAsPerson(id: SQLWrapper) {
  return sql`exists (select 1 from ${apiKeys} where ${apiKeys.principalId} = ${id}
    and ${apiKeys.kind} = 'personal' and ${apiKeys.createdAt} >= ${personalKeyCutoff})`
}

function isApiKey(id: SQLWrapper) {
  return sql`exists (select 1 from ${apiKeys} where ${apiKeys.principalId} = ${id})`
}

/**
 * The same rule for one message, as its event reports it: true when the reply
 * is automated. An event's reaction uses it, so the reaction and the message
 * rows agree, with one addition the rows cannot make. An older API key whose
 * principal is a person writes rows exactly like that person's inbox replies,
 * but its event carries a service actor; a reply sent by a service actor
 * through any key that does not reply as a person is automated. A message a
 * person sent (actor type 'user') is never automated, so only a service
 * actor's message costs a read.
 */
export async function isAutomatedAuthor(
  authorPrincipalId: PrincipalId | null,
  actor: { type?: string; principalId?: string } | undefined
): Promise<boolean> {
  if (actor?.type === 'user') return false
  // Raw parameters skip the typeid columns' mapping, so ids go in as uuids.
  const author = authorPrincipalId ? sql`${toUuid(authorPrincipalId)}::uuid` : sql`null::uuid`
  const actorId = actor?.principalId ? sql`${toUuid(actor.principalId)}::uuid` : sql`null::uuid`
  const rows = (await db.execute(sql`
    select (
      coalesce(${automatedPrincipal(author)}, false)
      or (${isApiKey(actorId)} and not ${keyRepliesAsPerson(actorId)})
    ) as automated
  `)) as unknown as Array<{ automated: boolean }>
  return rows[0]?.automated === true
}
