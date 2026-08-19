/**
 * Required-to-close enforcement. Invoked ONLY by the teammate inbox close
 * paths (setConversationStatusFn + the bulk close); API, workflow, and AI
 * closes call the conversation service directly and bypass by design
 * (a required field must never wedge an automation).
 */
import {
  db,
  eq,
  and,
  isNull,
  conversations,
  conversationAttributeDefinitions,
} from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  missingRequiredAttributes,
  formatMissingRequiredAttributes,
} from '@/lib/shared/conversation/attribute-values'

/**
 * Throw REQUIRED_ATTRIBUTES_MISSING (naming each unfilled attribute) when the
 * conversation cannot be closed yet. No-op when nothing is required.
 */
export async function assertRequiredAttributesForClose(
  conversationId: ConversationId
): Promise<void> {
  const required = await db
    .select({
      key: conversationAttributeDefinitions.key,
      label: conversationAttributeDefinitions.label,
    })
    .from(conversationAttributeDefinitions)
    .where(
      and(
        eq(conversationAttributeDefinitions.requiredToClose, true),
        isNull(conversationAttributeDefinitions.archivedAt)
      )
    )
  if (required.length === 0) return

  const [row] = await db
    .select({ customAttributes: conversations.customAttributes })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  if (!row) {
    throw new NotFoundError('CONVERSATION_NOT_FOUND', `Conversation ${conversationId} not found`)
  }

  const missing = missingRequiredAttributes(
    required.map((r) => ({ ...r, requiredToClose: true, archivedAt: null })),
    row.customAttributes ?? {}
  )
  if (missing.length > 0) {
    throw new ValidationError(
      'REQUIRED_ATTRIBUTES_MISSING',
      formatMissingRequiredAttributes(missing.map((m) => m.label))
    )
  }
}
