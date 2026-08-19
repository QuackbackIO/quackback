/**
 * Headless data + mutations for a single Quinn pending-action proposal: the
 * live status query, approve/reject mutations, busy flags, and an inline
 * error string. Both proposed-action cards need the exact same wiring
 * (components/conversation/pending-action-card.tsx for the inbox thread
 * note, the Copilot answer card for a Copilot-proposed action) — this hook
 * is the one place it lives, so a fix like the one below lands for both
 * instead of drifting between two copies.
 *
 * On a decide error the pending-action detail query is invalidated: a 409
 * (already decided/expired — another teammate raced this one) or a 403
 * (the approver's permissions changed) both mean the "proposed" view we're
 * showing is stale, so a refetch replaces the buttons with the real terminal
 * state (or a fresh permission check) instead of leaving them clickable.
 * This refetch previously existed only on the inbox card; the copilot card
 * lacked it, so a decide failure there left stale Approve/Reject buttons on
 * screen — this hook fixes that for both by construction.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AssistantPendingActionId } from '@quackback/ids'
import type { AssistantPendingActionDTO } from '@/lib/server/functions/assistant-actions'
import { assistantPendingActionQueries } from '@/lib/client/queries/assistant-pending-actions'
import {
  useApproveAssistantAction,
  useRejectAssistantAction,
} from '@/lib/client/mutations/assistant-pending-actions'

/** True for a 403 from the approve/reject gate: duck-typed off the DomainException
 *  shape (`statusCode`/`code`) rather than `instanceof`, since a thrown server-fn
 *  error's prototype chain isn't guaranteed to survive the RPC boundary, but its
 *  own enumerable properties are. */
function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const withMeta = error as Error & { statusCode?: number; code?: string }
  return withMeta.statusCode === 403 || withMeta.code === 'ASSISTANT_ACTION_PERMISSION_DENIED'
}

function decisionErrorMessage(error: unknown): string {
  if (isPermissionDeniedError(error)) return 'You do not have permission to approve this action.'
  return error instanceof Error && error.message ? error.message : 'Something went wrong'
}

export interface UsePendingActionDecisionResult {
  data: AssistantPendingActionDTO | undefined
  isLoading: boolean
  isError: boolean
  /** Either mutation is in flight — disables both buttons. */
  busy: boolean
  /** Specifically the approve mutation, for a per-button "Approving…" state. */
  approving: boolean
  /** Specifically the reject mutation, for a per-button "Rejecting…" state. */
  rejecting: boolean
  inlineError: string | null
  approve: () => void
  reject: () => void
}

/** Data + mutations for one pending action's Approve/Reject card. `id` is the
 *  `assistant_pending_actions` row id both the inbox note card and the
 *  Copilot answer card key their query and mutations on. */
export function usePendingActionDecision(
  id: AssistantPendingActionId
): UsePendingActionDecisionResult {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery(assistantPendingActionQueries.detail(id))
  const approveMutation = useApproveAssistantAction()
  const rejectMutation = useRejectAssistantAction()
  const [inlineError, setInlineError] = useState<string | null>(null)

  const busy = approveMutation.isPending || rejectMutation.isPending

  const decide = (mutate: typeof approveMutation.mutate) => {
    setInlineError(null)
    mutate(
      { pendingActionId: id },
      {
        onError: (error) => {
          setInlineError(decisionErrorMessage(error))
          void queryClient.invalidateQueries({
            queryKey: assistantPendingActionQueries.detail(id).queryKey,
          })
        },
      }
    )
  }

  return {
    data,
    isLoading,
    isError,
    busy,
    approving: approveMutation.isPending,
    rejecting: rejectMutation.isPending,
    inlineError,
    approve: () => decide(approveMutation.mutate),
    reject: () => decide(rejectMutation.mutate),
  }
}
