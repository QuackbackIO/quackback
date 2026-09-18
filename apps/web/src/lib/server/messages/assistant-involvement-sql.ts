/**
 * SQL fragments for Quinn's involvement lifecycle. Neutral territory so the
 * conversation list and inbox badge stay in lockstep without either domain
 * importing the other (same reason pair-link.ts lives here).
 */
import { sql, conversations, assistantInvolvements } from '@/lib/server/db'

/**
 * Conversations Quinn is still handling: an active involvement means the
 * thread is in the bot inbox, not the human Unassigned queue. Used by the
 * Unassigned list filter and the Unassigned nav badge.
 */
export function notHandledByAssistantSql() {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${assistantInvolvements} ai
    WHERE ai.conversation_id = ${conversations.id}
      AND ai.status = 'active'
  )`
}
