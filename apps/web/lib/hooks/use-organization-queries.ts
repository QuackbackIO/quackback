'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// ============================================================================
// Query Key Factory
// ============================================================================

export const organizationKeys = {
  all: ['organization'] as const,
  logo: (organizationId: string) => [...organizationKeys.all, 'logo', organizationId] as const,
  headerLogo: (organizationId: string) =>
    [...organizationKeys.all, 'headerLogo', organizationId] as const,
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

type HeaderDisplayMode = 'logo_and_name' | 'logo_only' | 'custom_logo'

interface HeaderLogoData {
  headerLogoUrl: string | null
  hasHeaderLogo: boolean
  headerDisplayMode: HeaderDisplayMode
  headerDisplayName: string | null
}

interface UploadHeaderLogoResponse {
  success: boolean
  headerLogoUrl: string
  headerDisplayMode: HeaderDisplayMode
}

interface UpdateDisplayModeResponse {
  success: boolean
  headerDisplayMode?: HeaderDisplayMode
  headerDisplayName?: string | null
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

// ============================================================================
// Header Logo Hooks
// ============================================================================

/**
 * Query hook to fetch organization header logo and display mode.
 */
export function useOrganizationHeaderLogo(organizationId: string) {
  return useQuery({
    queryKey: organizationKeys.headerLogo(organizationId),
    queryFn: async (): Promise<HeaderLogoData> => {
      const response = await fetch(`/api/organization/header-logo?organizationId=${organizationId}`)
      if (!response.ok) throw new Error('Failed to fetch header logo')
      return response.json()
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

/**
 * Mutation hook to upload organization header logo.
 * Updates the query cache on success.
 */
export function useUploadOrganizationHeaderLogo(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File): Promise<UploadHeaderLogoResponse> => {
      const formData = new FormData()
      formData.append('headerLogo', file)
      formData.append('organizationId', organizationId)

      const response = await fetch('/api/organization/header-logo', {
        method: 'PATCH',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to upload header logo')
      }

      return response.json()
    },
    onSuccess: (data) => {
      // Update cache with new header logo, preserving display name
      queryClient.setQueryData<HeaderLogoData>(
        organizationKeys.headerLogo(organizationId),
        (old) => ({
          headerLogoUrl: data.headerLogoUrl,
          hasHeaderLogo: true,
          headerDisplayMode: data.headerDisplayMode,
          headerDisplayName: old?.headerDisplayName ?? null,
        })
      )
    },
  })
}

/**
 * Mutation hook to update header display mode.
 */
export function useUpdateHeaderDisplayMode(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      headerDisplayMode: HeaderDisplayMode
    ): Promise<UpdateDisplayModeResponse> => {
      const response = await fetch('/api/organization/header-logo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, headerDisplayMode }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update display mode')
      }

      return response.json()
    },
    onSuccess: (data) => {
      // Update cache with new display mode, preserving other fields
      queryClient.setQueryData<HeaderLogoData>(
        organizationKeys.headerLogo(organizationId),
        (old) => ({
          headerLogoUrl: old?.headerLogoUrl ?? null,
          hasHeaderLogo: old?.hasHeaderLogo ?? false,
          headerDisplayMode: data.headerDisplayMode ?? old?.headerDisplayMode ?? 'logo_and_name',
          headerDisplayName: data.headerDisplayName ?? old?.headerDisplayName ?? null,
        })
      )
    },
  })
}

/**
 * Mutation hook to delete organization header logo.
 * Resets display mode to 'logo_and_name'.
 */
export function useDeleteOrganizationHeaderLogo(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<{ success: boolean }> => {
      const response = await fetch(
        `/api/organization/header-logo?organizationId=${organizationId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete header logo')
      }

      return response.json()
    },
    onSuccess: () => {
      // Clear header logo from cache and reset display mode, preserving display name
      queryClient.setQueryData<HeaderLogoData>(
        organizationKeys.headerLogo(organizationId),
        (old) => ({
          headerLogoUrl: null,
          hasHeaderLogo: false,
          headerDisplayMode: 'logo_and_name',
          headerDisplayName: old?.headerDisplayName ?? null,
        })
      )
    },
  })
}

/**
 * Mutation hook to update header display name.
 * Pass empty string or null to clear the custom name (falls back to org name).
 */
export function useUpdateHeaderDisplayName(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (headerDisplayName: string | null): Promise<UpdateDisplayModeResponse> => {
      const response = await fetch('/api/organization/header-logo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, headerDisplayName }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update display name')
      }

      return response.json()
    },
    onSuccess: (data) => {
      // Update cache with new display name
      queryClient.setQueryData<HeaderLogoData>(
        organizationKeys.headerLogo(organizationId),
        (old) => ({
          headerLogoUrl: old?.headerLogoUrl ?? null,
          hasHeaderLogo: old?.hasHeaderLogo ?? false,
          headerDisplayMode: old?.headerDisplayMode ?? 'logo_and_name',
          headerDisplayName: data.headerDisplayName ?? null,
        })
      )
    },
  })
}
