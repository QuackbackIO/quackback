/** Read-only grounding from connector calls this teammate already approved. */
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db, assistantPendingActions, conversations, tickets } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { parseConnectorToolName, type ConnectorToolPolicy } from '@/lib/shared/assistant/connectors'
import type { AssistantToolSpec } from './assistant.toolspec'
import { RETRIEVED_CONTENT_NOTE, wrapUntrustedText } from './injection-guard'

export const APPROVED_CONNECTOR_RESULT_LIMIT = 8
export const APPROVED_CONNECTOR_RESULT_CHARS = 6000
export const APPROVED_CONNECTOR_CONTEXT_CHARS = 16000

export interface OwnApprovedConnectorResultsInput {
  askerActor?: Actor
  conversationId?: ConversationId | null
  ticketId?: TicketId | null
  /** The current server-resolved connector catalogue, never client tool names. */
  connectorSpecs: ReadonlyArray<
    Pick<AssistantToolSpec, 'name' | 'connector' | 'permissions'> & {
      approvalPolicy?: ConnectorToolPolicy
    }
  >
}

/**
 * The request workspace's db proxy supplies isolation. The exact parent,
 * decider and current tool catalogue narrow further: one teammate's approval
 * never becomes another teammate's private Copilot history. No connector is
 * contacted here. Existing item viewability is repeated in SQL so direct
 * runtime callers cannot bypass the HTTP gate.
 */
export async function loadOwnApprovedConnectorResults(
  input: OwnApprovedConnectorResultsInput,
  exec: Executor = db
): Promise<string | null> {
  const actor = input.askerActor
  if (!actor?.principalId || actor.principalType !== 'user' || !can(actor, PERMISSIONS.COPILOT_USE))
    return null
  const { conversationId, ticketId } = input
  if (!!conversationId === !!ticketId) return null
  const allowedNames = input.connectorSpecs
    .filter(
      (spec) =>
        parseConnectorToolName(spec.name) &&
        spec.connector &&
        spec.approvalPolicy !== 'never' &&
        spec.permissions.every((permission) => can(actor, permission))
    )
    .map((spec) => spec.name)
  if (!allowedNames.length) return null

  // Match the single-item conversation gate (view permission or owning
  // visitor), rather than the deliberately narrower inbox-list predicate.
  const visibleConversation = or(
    can(actor, PERMISSIONS.CONVERSATION_VIEW) ? sql`true` : sql`false`,
    eq(conversations.visitorPrincipalId, actor.principalId)
  )
  const parent = conversationId
    ? and(
        eq(assistantPendingActions.conversationId, conversationId),
        isNull(assistantPendingActions.ticketId),
        sql`exists (select 1 from ${conversations} where ${and(eq(conversations.id, conversationId), visibleConversation)})`
      )
    : and(
        eq(assistantPendingActions.ticketId, ticketId!),
        isNull(assistantPendingActions.conversationId),
        sql`exists (select 1 from ${tickets} where ${and(eq(tickets.id, ticketId!), ticketFilter(actor))})`
      )
  const rows = await exec
    .select({ summary: assistantPendingActions.summary, result: assistantPendingActions.result })
    .from(assistantPendingActions)
    .where(
      and(
        parent,
        isNull(assistantPendingActions.workspaceThreadKey),
        eq(assistantPendingActions.decidedById, actor.principalId),
        eq(assistantPendingActions.originRole, 'copilot_qa'),
        eq(assistantPendingActions.status, 'executed'),
        isNotNull(assistantPendingActions.executedAt),
        isNotNull(assistantPendingActions.result),
        inArray(assistantPendingActions.toolName, allowedNames)
      )
    )
    .orderBy(desc(assistantPendingActions.executedAt), desc(assistantPendingActions.id))
    .limit(APPROVED_CONNECTOR_RESULT_LIMIT)

  const blocks: string[] = []
  let remaining = APPROVED_CONNECTOR_CONTEXT_CHARS
  for (const row of rows) {
    const result = row.result
    if (!result || result.ok !== true || typeof result.data !== 'string' || !result.data.trim())
      continue
    const receipt = JSON.stringify({
      summary: row.summary.slice(0, 240),
      data: result.data.slice(0, APPROVED_CONNECTOR_RESULT_CHARS),
      ...(result.data.length > APPROVED_CONNECTOR_RESULT_CHARS ? { truncated: true } : {}),
      ...(typeof result.note === 'string' ? { note: result.note.slice(0, 240) } : {}),
    })
    const block = wrapUntrustedText(
      'Previously approved connector result',
      `${RETRIEVED_CONTENT_NOTE}\n${receipt}`
    )
    const cost = block.length + (blocks.length ? 1 : 0)
    if (cost > remaining) break
    blocks.unshift(block)
    remaining -= cost
  }
  return blocks.length ? blocks.join('\n') : null
}
