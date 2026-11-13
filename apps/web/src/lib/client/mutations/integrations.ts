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
import {
  addIntegrationDestinationFn,
  reconnectIntegrationDestinationFn,
  removeIntegrationDestinationFn,
  setIntegrationDestinationConfigFn,
  setIntegrationDestinationEnabledFn,
} from '@/lib/server/functions/integration-destinations'

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

/** Start syncing one more destination (a GitHub repository). The caller reports the outcome. */
export function useAddIntegrationDestination() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { integrationType: string; kind: string; externalId: string }) =>
      addIntegrationDestinationFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/** Stop syncing a destination; its links and webhook go with it. */
export function useRemoveIntegrationDestination() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (destinationId: string) =>
      removeIntegrationDestinationFn({ data: { destinationId } }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/** Switch a destination on or off. */
export function useSetIntegrationDestinationEnabled() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { destinationId: string; enabled: boolean }) =>
      setIntegrationDestinationEnabledFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/** Patch a destination's settings (GitHub: which way it syncs). */
export function useSetIntegrationDestinationConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { destinationId: string; config: Record<string, unknown> }) =>
      setIntegrationDestinationConfigFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}
