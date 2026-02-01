/**
 * Integration mutations
 *
 * Mutation hooks for managing integrations (Slack, webhooks, etc.)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  updateIntegrationFn,
  deleteIntegrationFn,
  type UpdateIntegrationInput,
  type DeleteIntegrationInput,
} from '@/lib/server-functions/integrations'

/**
 * Mutation hook for updating integration config and event mappings
 */
export function useUpdateIntegration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateIntegrationInput) => updateIntegrationFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/**
 * Mutation hook for deleting an integration
 */
export function useDeleteIntegration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: DeleteIntegrationInput) => deleteIntegrationFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}
