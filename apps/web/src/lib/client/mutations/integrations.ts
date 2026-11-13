/**
 * Integration mutations
 *
 * Mutation hooks for managing integrations (Slack, webhooks, etc.)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  updateIntegrationFn,
  deleteIntegrationFn,
  addNotificationChannelFn,
  updateNotificationChannelFn,
  removeNotificationChannelFn,
  type UpdateIntegrationInput,
  type DeleteIntegrationInput,
  type AddNotificationChannelInput,
  type UpdateNotificationChannelInput,
  type RemoveNotificationChannelInput,
} from '@/lib/server/functions/integrations'
import { reconnectIntegrationDestinationFn } from '@/lib/server/functions/integration-destinations'

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

/**
 * Add a notification channel with event mappings
 */
export function useAddNotificationChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: AddNotificationChannelInput) => addNotificationChannelFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/**
 * Update a notification channel's events and board filter
 */
export function useUpdateNotificationChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateNotificationChannelInput) =>
      updateNotificationChannelFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/**
 * Remove a notification channel and all its event mappings
 */
export function useRemoveNotificationChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: RemoveNotificationChannelInput) =>
      removeNotificationChannelFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/**
 * Register a destination's webhook again (the settings page's "Repair
 * webhook"). The caller reports the outcome.
 */
export function useReconnectIntegrationDestination() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (destinationId: string) =>
      reconnectIntegrationDestinationFn({ data: { destinationId } }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}
