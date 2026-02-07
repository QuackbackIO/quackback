/**
 * Mutation hooks for platform credential management.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  savePlatformCredentialsFn,
  deletePlatformCredentialsFn,
} from '@/lib/server/functions/platform-credentials'

/**
 * Save platform credentials for an integration type.
 * Invalidates catalog, integrations, and platform credentials queries.
 */
export function useSavePlatformCredentials() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { integrationType: string; credentials: Record<string, string> }) =>
      savePlatformCredentialsFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrationCatalog'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'platformCredentials'] })
    },
  })
}

/**
 * Delete platform credentials for an integration type.
 * Invalidates catalog, integrations, and platform credentials queries.
 */
export function useDeletePlatformCredentials() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { integrationType: string }) =>
      deletePlatformCredentialsFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrationCatalog'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'platformCredentials'] })
    },
  })
}
