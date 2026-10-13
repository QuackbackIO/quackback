import { db, assistantInvolvements, eq, type Transaction } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import type { SupportAgent } from './support-agents.service'

/** The agent's active involvement on the conversation, opened if it has none. */
export async function engage(
  agent: SupportAgent,
  conversationId: ConversationId,
  exec: Transaction | typeof db = db
) {
  const { getLatestInvolvement, openInvolvement, voidAssumedResolutionForConversation } =
    await import('@/lib/server/domains/assistant')
  const revived = await voidAssumedResolutionForConversation(conversationId, exec)
  const latest = revived ?? (await getLatestInvolvement(conversationId, exec))
  if (latest?.status === 'active') {
    if (latest.supportAgentId === agent.id) return latest
    // Another answerer was engaged before this agent took over.
    await exec
      .update(assistantInvolvements)
      .set({ status: 'abandoned', endedAt: new Date() })
      .where(eq(assistantInvolvements.id, latest.id))
  }
  return openInvolvement(
    {
      conversationId,
      triggeredBy: 'first_touch',
      supportAgentId: agent.id,
    },
    exec
  )
}
