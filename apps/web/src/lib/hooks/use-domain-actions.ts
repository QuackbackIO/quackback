import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  fetchDomainsFn,
  addDomainFn,
  deleteDomainFn,
  setDomainPrimaryFn,
  refreshDomainVerificationFn,
} from '@/lib/server-functions/domains'
import type { Domain } from '@/lib/domains'

// ============================================================================
// Query Key Factory
// ============================================================================

export const domainKeys = {
  all: ['domains'] as const,
  lists: () => [...domainKeys.all, 'list'] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook to list all domains for the workspace.
 * Returns empty array in self-hosted mode.
 */
export function useDomains() {
  return useSuspenseQuery({
    queryKey: domainKeys.lists(),
    queryFn: fetchDomainsFn,
    staleTime: 30 * 1000, // 30 seconds - domains may change status
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to add a new custom domain.
 */
export function useAddDomain() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (domain: string) => addDomainFn({ data: { domain } }),
    onMutate: async (domain) => {
      await queryClient.cancelQueries({ queryKey: domainKeys.lists() })
      const previous = queryClient.getQueryData<Domain[]>(domainKeys.lists())

      // Optimistic update - add pending domain
      const optimisticDomain: Domain = {
        id: `domain_temp_${Date.now()}`,
        workspaceId: '',
        domain: domain.toLowerCase(),
        domainType: 'custom',
        isPrimary: false,
        verified: false,
        verificationToken: null,
        cloudflareHostnameId: null,
        sslStatus: 'initializing',
        ownershipStatus: 'pending',
        createdAt: new Date(),
      }
      queryClient.setQueryData<Domain[]>(domainKeys.lists(), (old) =>
        old ? [...old, optimisticDomain] : [optimisticDomain]
      )

      return { previous }
    },
    onError: (_err, _domain, context) => {
      if (context?.previous) {
        queryClient.setQueryData(domainKeys.lists(), context.previous)
      }
    },
    onSuccess: () => {
      toast.success('Domain added successfully')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() })
    },
  })
}

/**
 * Hook to delete a domain.
 */
export function useDeleteDomain() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (domainId: string) => deleteDomainFn({ data: { domainId } }),
    onMutate: async (domainId) => {
      await queryClient.cancelQueries({ queryKey: domainKeys.lists() })
      const previous = queryClient.getQueryData<Domain[]>(domainKeys.lists())

      // Optimistic update - remove domain
      queryClient.setQueryData<Domain[]>(domainKeys.lists(), (old) =>
        old?.filter((d) => d.id !== domainId)
      )

      return { previous }
    },
    onError: (_err, _domainId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(domainKeys.lists(), context.previous)
      }
      toast.error('Failed to delete domain')
    },
    onSuccess: () => {
      toast.success('Domain deleted')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() })
    },
  })
}

/**
 * Hook to set a domain as primary.
 */
export function useSetDomainPrimary() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (domainId: string) => setDomainPrimaryFn({ data: { domainId } }),
    onMutate: async (domainId) => {
      await queryClient.cancelQueries({ queryKey: domainKeys.lists() })
      const previous = queryClient.getQueryData<Domain[]>(domainKeys.lists())

      // Optimistic update - set as primary
      queryClient.setQueryData<Domain[]>(domainKeys.lists(), (old) =>
        old?.map((d) => ({
          ...d,
          isPrimary: d.id === domainId,
        }))
      )

      return { previous }
    },
    onError: (_err, _domainId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(domainKeys.lists(), context.previous)
      }
      toast.error('Failed to set primary domain')
    },
    onSuccess: () => {
      toast.success('Primary domain updated')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() })
    },
  })
}

/**
 * Hook to refresh domain verification status.
 */
export function useRefreshDomainVerification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (domainId: string) => refreshDomainVerificationFn({ data: { domainId } }),
    onSuccess: (updatedDomain) => {
      // Update the domain in the cache
      queryClient.setQueryData<Domain[]>(domainKeys.lists(), (old) =>
        old?.map((d) => (d.id === updatedDomain.id ? updatedDomain : d))
      )
      toast.success('Verification status refreshed')
    },
    onError: () => {
      toast.error('Failed to refresh status')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() })
    },
  })
}
