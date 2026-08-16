import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createConnectorFn,
  deleteConnectorFn,
  refreshConnectorFn,
  startConnectorOAuthFn,
  updateConnectorFn,
} from '@/lib/server/functions/assistant-connectors'
import type { ConnectorCreateInput, ConnectorUpdateInput } from '@/lib/shared/assistant/connectors'
import { connectorKeys } from '@/lib/client/queries/assistant-connectors'
import { assistantKeys } from '@/lib/client/queries/assistant'

export function useCreateConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ConnectorCreateInput) => createConnectorFn({ data: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all() })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.configChangelog() })
    },
  })
}

export function useUpdateConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ConnectorUpdateInput) => updateConnectorFn({ data: input }),
    onSuccess: (_row, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all() })
      void queryClient.invalidateQueries({ queryKey: connectorKeys.detail(input.id) })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.configChangelog() })
    },
  })
}

export function useRefreshConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => refreshConnectorFn({ data: { id } }),
    onSuccess: (_row, id) => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all() })
      void queryClient.invalidateQueries({ queryKey: connectorKeys.detail(id) })
    },
  })
}

export function useStartConnectorOAuth() {
  return useMutation({
    mutationFn: (id: string) => startConnectorOAuthFn({ data: { id } }),
  })
}

export function useDeleteConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteConnectorFn({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all() })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.configChangelog() })
    },
  })
}
