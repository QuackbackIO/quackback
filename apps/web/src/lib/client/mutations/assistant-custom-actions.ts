/** Custom-action library CRUD + test-run mutations (QUINN-TWO-AGENT-SPEC D6/Phase 5). */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AssistantCustomActionId } from '@quackback/ids'
import {
  createCustomActionFn,
  deleteCustomActionFn,
  testCustomActionFn,
  updateCustomActionFn,
} from '@/lib/server/functions/assistant-custom-actions'
import type { AssistantActionInput } from '@/lib/shared/assistant/custom-actions'
import { assistantKeys } from '@/lib/client/queries/assistant'

export function useCreateCustomAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AssistantActionInput) => createCustomActionFn({ data: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.customActions() })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.configChangelog() })
    },
  })
}

export function useUpdateCustomAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: AssistantActionInput & { id: AssistantCustomActionId }) =>
      updateCustomActionFn({ data: { id, ...input } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.customActions() })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.configChangelog() })
    },
  })
}

export function useDeleteCustomAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: AssistantCustomActionId) => deleteCustomActionFn({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.customActions() })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.configChangelog() })
    },
  })
}

/** No invalidation: a test run never mutates saved config. */
export function useTestCustomAction() {
  return useMutation({
    mutationFn: (data: Parameters<typeof testCustomActionFn>[0]['data']) =>
      testCustomActionFn({ data }),
  })
}
