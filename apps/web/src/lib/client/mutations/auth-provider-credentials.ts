/**
 * Mutation hooks for auth provider credential management.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  saveAuthProviderCredentialsFn,
  deleteAuthProviderCredentialsFn,
} from '@/lib/server/functions/auth-provider-credentials'

/**
 * Save auth provider credentials.
 * Invalidates auth provider status and credential queries.
 */
export function useSaveAuthProviderCredentials() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { credentialType: string; credentials: Record<string, string> }) =>
      saveAuthProviderCredentialsFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'authProviderStatus'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'authProviderCredentials'] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'portalConfig'] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'publicPortalConfig'] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'publicAuthConfig'] })
    },
  })
}

/**
 * Delete auth provider credentials.
 * Invalidates auth provider status, credential queries, and portal config.
 */
export function useDeleteAuthProviderCredentials() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { credentialType: string }) =>
      deleteAuthProviderCredentialsFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'authProviderStatus'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'authProviderCredentials'] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'portalConfig'] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'publicPortalConfig'] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'publicAuthConfig'] })
    },
  })
}
