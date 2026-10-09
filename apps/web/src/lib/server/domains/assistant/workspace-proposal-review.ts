import { createId } from '@quackback/ids'
import {
  and,
  eq,
  sql,
  conversationMessages,
  workspaceAssistantThreads,
  type Transaction,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { WorkspaceCopilotFinalPayload } from '@/lib/shared/assistant/workspace-contract'
import type { AssistantPendingAction } from './pending-actions.service'
import { assertWorkspaceThreadOwned } from './workspace-threads.service'

/** External proposals have a private, persisted card a person can review. */
export async function publishWorkspaceProposalReviewInTransaction(
  tx: Transaction,
  actor: Actor,
  pending: AssistantPendingAction
): Promise<string> {
  const key = pending.workspaceThreadKey!
  const thread = await assertWorkspaceThreadOwned(key, actor, tx, true)
  const runId = `proposal:${pending.id}`
  const [existing] = await tx
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.workspaceThreadKey, key),
        eq(conversationMessages.senderType, 'agent'),
        sql`${conversationMessages.metadata}->'workspaceTurn'->>'runId' = ${runId}`
      )
    )
    .limit(1)
  const id = existing?.id ?? createId('conversation_message')
  const payload: WorkspaceCopilotFinalPayload = {
    threadKey: key,
    messageId: id,
    text: '',
    citations: [],
    proposedActions: [
      { id: pending.id, toolName: pending.toolName, summary: pending.summary, label: 'Copilot' },
    ],
    navigation: [],
  }
  const metadata = {
    workspaceTurn: { runId, payload: payload as unknown as Record<string, unknown> },
  }
  if (existing) {
    await tx.update(conversationMessages).set({ metadata }).where(eq(conversationMessages.id, id))
  } else {
    await tx.insert(conversationMessages).values({
      id,
      workspaceThreadKey: key,
      principalId: null,
      senderType: 'agent',
      content: '',
      isInternal: true,
      createdAt: new Date(),
      metadata,
    })
    await tx
      .update(workspaceAssistantThreads)
      .set({ revision: thread.revision + 1, updatedAt: new Date() })
      .where(eq(workspaceAssistantThreads.key, key))
  }
  return `/admin?copilotThread=${encodeURIComponent(key)}`
}
