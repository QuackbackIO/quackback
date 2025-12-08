'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// ============================================================================
// Query Key Factory
// ============================================================================

export const organizationKeys = {
  all: ['organization'] as const,
  logo: (organizationId: string) => [...organizationKeys.all, 'logo', organizationId] as const,
}

// ============================================================================
// Types
// ============================================================================

interface OrganizationLogoData {
  logoUrl: string | null
  hasCustomLogo: boolean
}

interface UploadLogoResponse {
  success: boolean
  logoUrl: string
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Query hook to fetch organization logo.
 * Uses SSR-provided initial data when available to prevent flash.
 */
export function useOrganizationLogo(organizationId: string) {
  return useQuery({
    queryKey: organizationKeys.logo(organizationId),
    queryFn: async (): Promise<OrganizationLogoData> => {
      const response = await fetch(`/api/organization/logo?organizationId=${organizationId}`)
      if (!response.ok) throw new Error('Failed to fetch logo')
      return response.json()
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Mutation hook to upload organization logo.
 * Updates the query cache on success.
 */
export function useUploadOrganizationLogo(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (logoBlob: Blob): Promise<UploadLogoResponse> => {
      const formData = new FormData()
      formData.append('logo', logoBlob, 'logo.jpg')
      formData.append('organizationId', organizationId)

      const response = await fetch('/api/organization/logo', {
        method: 'PATCH',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to upload logo')
      }

      return response.json()
    },
    onSuccess: (data) => {
      // Update cache with new logo URL
      queryClient.setQueryData<OrganizationLogoData>(organizationKeys.logo(organizationId), {
        logoUrl: data.logoUrl,
        hasCustomLogo: true,
      })
    },
  })
}

/**
 * Mutation hook to delete organization logo.
 * Clears the logo from the query cache on success.
 */
export function useDeleteOrganizationLogo(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<{ success: boolean }> => {
      const response = await fetch(`/api/organization/logo?organizationId=${organizationId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete logo')
      }

      return response.json()
    },
    onSuccess: () => {
      // Clear logo from cache
      queryClient.setQueryData<OrganizationLogoData>(organizationKeys.logo(organizationId), {
        logoUrl: null,
        hasCustomLogo: false,
      })
    },
  })
}
