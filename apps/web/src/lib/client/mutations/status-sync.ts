/**
 * Status sync mutation hooks.
 *
 * Enable/disable inbound webhook status sync and update status mappings.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  enableStatusSyncFn,
  disableStatusSyncFn,
  updateStatusMappingsFn,
  updateTicketStatusMappingsFn,
} from '@/lib/server/functions/status-sync'

export function useEnableStatusSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { integrationId: string; integrationType: string }) =>
      enableStatusSyncFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

export function useDisableStatusSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { integrationId: string; integrationType: string }) =>
      disableStatusSyncFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

export function useUpdateStatusMappings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { integrationId: string; statusMappings: Record<string, string | null> }) =>
      updateStatusMappingsFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}

export function useUpdateTicketStatusMappings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      integrationId: string
      ticketStatusMappings: Record<string, string | null>
    }) => updateTicketStatusMappingsFn({ data: input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
  })
}
