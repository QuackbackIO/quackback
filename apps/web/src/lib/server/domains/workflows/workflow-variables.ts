/**
 * The v1 dynamic-variable resolver for workflow message blocks: reads a
 * conversation's visitor principal plus the workspace name and builds the
 * `Record<string, string>` a message block's `interpolate()` call reads.
 *
 * Mirrors `buildMacroContext` (@/lib/server/domains/macros/macro.service)
 * for the visitor lookup, but the two are deliberately not shared: macro
 * variables are camelCase and independently versioned from the workflow
 * catalogue in `@/lib/shared/workflows/message-variables`, and folding them
 * together would couple two features that evolve on their own schedules.
 *
 * Every catalogue key is always present in the returned record: a missing
 * or empty source value resolves to "", which `interpolate()` treats
 * identically to an absent key (fallback, or empty string with none).
 */
import { db, eq, conversations, principal, user, settings } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { realEmail } from '@/lib/shared/anonymous-email'
import { firstNameOf } from '@/lib/shared/conversation/personalize'
import { resolveReplyRecipient } from '@/lib/server/domains/conversation/conversation.recipient'
import type { WorkflowVariableKey } from '@/lib/shared/workflows/message-variables'

/** The v1 catalogue values, keyed exactly as `WORKFLOW_VARIABLE_CATALOGUE` declares. */
export type WorkflowVariables = Record<WorkflowVariableKey, string>

/**
 * Resolve the dynamic-variable catalogue for a conversation. Throws
 * NotFoundError if the conversation doesn't exist: callers (the action
 * executor) run this inside an already-validated dispatch, where a missing
 * conversation is an invariant violation, not a normal "nothing to send".
 */
export async function resolveWorkflowVariables(
  conversationId: ConversationId
): Promise<WorkflowVariables> {
  const [row] = await db
    .select({
      type: principal.type,
      displayName: principal.displayName,
      contactEmail: principal.contactEmail,
      userName: user.name,
      userEmail: user.email,
    })
    .from(conversations)
    .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) throw new NotFoundError('NOT_FOUND', 'Conversation not found')

  const [workspace] = await db.select({ name: settings.name }).from(settings).limit(1)

  // Best available full name: synced user.name wins, falling back to the
  // principal's own displayName (matches buildMacroContext's precedence).
  const fullName = (row.userName ?? row.displayName ?? '').trim()

  // Same email precedence as conversation replies (resolveReplyRecipient):
  // an identified visitor's account email wins; an anonymous visitor's
  // account email is a synthetic placeholder, so the real contact email
  // captured on the principal takes over instead. realEmail() is a final
  // sanitization pass so a synthetic address can never slip through either
  // branch.
  const email = resolveReplyRecipient(
    { type: row.type, email: row.userEmail },
    row.contactEmail,
    null
  )

  return {
    first_name: firstNameOf(fullName) ?? '',
    name: fullName,
    email: realEmail(email) ?? '',
    workspace_name: workspace?.name ?? '',
  }
}
