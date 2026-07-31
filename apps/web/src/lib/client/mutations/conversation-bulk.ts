/**
 * Bulk inbox mutation: apply one action (assign, priority, snooze, tag, macro
 * reply, close, reopen) to many conversations in a single call. The command bar / inbox list call
 * `mutateAsync` and toast the returned partial-failure summary. On success every
 * admin conversation list is invalidated (the batch changed status/assignee/
 * priority/labels) along with each affected open thread.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import { bulkUpdateConversationsFn } from '@/lib/server/functions/conversation'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { CONVERSATION_TAGS_KEY } from '@/lib/client/hooks/use-conversation-tags'

/** One inbox bulk action — mirrors the server fn's discriminated union. */
export type BulkConversationAction =
  | { type: 'assign'; assignTo: string | null }
  | { type: 'assign_team'; teamId: string | null }
  | { type: 'priority'; priority: ConversationPriority }
  | { type: 'snooze'; until: string | null }
  | { type: 'tag'; tagId: string }
  | { type: 'macro'; macroId: string }
  | { type: 'close' }
  | { type: 'reopen' }

export interface BulkConversationInput {
  conversationIds: string[]
  action: BulkConversationAction
}

/** Per-item outcome so the caller can toast partial failures. */
export interface BulkConversationSummary {
  succeeded: string[]
  failed: { id: string; reason: string }[]
}

export function useBulkConversationUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BulkConversationInput): Promise<BulkConversationSummary> =>
      bulkUpdateConversationsFn({ data: input }),
    onSuccess: (summary, input) => {
      // Prefix-invalidate every admin inbox list (all scopes/filters) so the
      // batch's changes land immediately.
      void queryClient.invalidateQueries({ queryKey: conversationKeys.agentConversations() })
      // A labelling batch also moves the nav's per-label counts, which live
      // under the label-taxonomy prefix rather than under the list keys.
      if (input.action.type === 'tag') {
        void queryClient.invalidateQueries({ queryKey: CONVERSATION_TAGS_KEY })
      }
      // Refresh any open thread the batch touched so a detail panel reflects it.
      for (const id of summary.succeeded) {
        void queryClient.invalidateQueries({
          queryKey: conversationKeys.agentThread(id as ConversationId),
        })
      }
    },
  })
}
