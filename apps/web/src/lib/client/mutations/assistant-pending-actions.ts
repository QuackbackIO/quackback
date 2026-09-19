/**
 * Approve/reject mutations for Quinn's pending write-tool proposals: thin
 * wrappers over the committed approve/reject server fns that seed the
 * pending-action detail cache with the settled row (so the card's terminal
 * state shows immediately) and refresh the open thread (approval can change
 * the conversation itself, e.g. a status change).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AssistantPendingActionId, ConversationId } from '@quackback/ids'
import {
  approveAssistantActionFn,
  rejectAssistantActionFn,
} from '@/lib/server/functions/assistant-actions'
import { reconcileAssistantActionFn } from '@/lib/server/functions/assistant-pending-actions'
import { assistantPendingActionKeys } from '@/lib/client/queries/assistant-pending-actions'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'

/** Seed the detail cache with the settled row and refresh the owning thread. */
function useDecideAssistantAction(decide: typeof approveAssistantActionFn) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { pendingActionId: AssistantPendingActionId }) => decide({ data: vars }),
    onSuccess: (settled, vars) => {
      queryClient.setQueryData(assistantPendingActionKeys.detail(vars.pendingActionId), settled)
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.agentThread(settled.conversationId as ConversationId),
      })
    },
  })
}

export function useApproveAssistantAction() {
  return useDecideAssistantAction(approveAssistantActionFn)
}

export function useRejectAssistantAction() {
  return useDecideAssistantAction(rejectAssistantActionFn)
}

/**
 * Record a person's verdict on an unconfirmed effect.
 *
 * Invalidates the action's own row and the review queue, because both are
 * showing a state the verdict has just left. There is no optimistic update: an
 * unconfirmed effect is the last place to guess at an outcome.
 */
export function useReconcileAssistantAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      pendingActionId?: AssistantPendingActionId
      receiptId?: string
      verdict: 'resolved' | 'failed'
      note: string
    }) => reconcileAssistantActionFn({ data: vars }),
    onSuccess: (_result, vars) => {
      if (vars.pendingActionId) {
        void queryClient.invalidateQueries({
          queryKey: assistantPendingActionKeys.detail(vars.pendingActionId),
        })
      }
      void queryClient.invalidateQueries({
        queryKey: assistantPendingActionKeys.reviewQueue(),
      })
    },
  })
}
