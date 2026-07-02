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
  addMonitoredChannelFn,
  updateMonitoredChannelFn,
  removeMonitoredChannelFn,
  upsertUserMappingFn,
  deleteUserMappingFn,
  type UpdateIntegrationInput,
  type DeleteIntegrationInput,
  type AddNotificationChannelInput,
  type UpdateNotificationChannelInput,
  type RemoveNotificationChannelInput,
  type AddMonitoredChannelInput,
  type UpdateMonitoredChannelInput,
  type RemoveMonitoredChannelInput,
  type UpsertUserMappingInput,
  type DeleteUserMappingInput,
} from '@/lib/server/functions/integrations'

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
 * Add a channel to monitoring
 */
export function useAddMonitoredChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: AddMonitoredChannelInput) => addMonitoredChannelFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/**
 * Update a monitored channel (toggle enabled, change board)
 */
export function useUpdateMonitoredChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateMonitoredChannelInput) => updateMonitoredChannelFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/**
 * Remove a monitored channel
 */
export function useRemoveMonitoredChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: RemoveMonitoredChannelInput) => removeMonitoredChannelFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/**
 * Upsert an integration user mapping (GitHub username ↔ workspace member)
 */
export function useUpsertUserMapping() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpsertUserMappingInput) => upsertUserMappingFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

/**
 * Delete an integration user mapping
 */
export function useDeleteUserMapping() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: DeleteUserMappingInput) => deleteUserMappingFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}
