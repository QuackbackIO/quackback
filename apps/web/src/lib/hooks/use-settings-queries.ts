'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  uploadLogoAction,
  deleteLogoAction,
  uploadHeaderLogoAction,
  deleteHeaderLogoAction,
  updateHeaderDisplayModeAction,
  updateHeaderDisplayNameAction,
} from '@/lib/actions/settings'

// Query keys
export const settingsKeys = {
  all: ['settings'] as const,
  logo: () => [...settingsKeys.all, 'logo'] as const,
  headerLogo: () => [...settingsKeys.all, 'headerLogo'] as const,
}

// Types
interface LogoData {
  logoUrl: string | null
  hasCustomLogo: boolean
}

interface HeaderLogoData {
  headerLogoUrl: string | null
  headerDisplayMode: string | null
  headerDisplayName: string | null
  hasCustomHeaderLogo: boolean
}

// Logo hooks (simplified - returns initial data only for now)
export function useWorkspaceLogo() {
  return useQuery({
    queryKey: settingsKeys.logo(),
    queryFn: async (): Promise<LogoData> => {
      // For now, return empty - the initial data from SSR will be used
      return { logoUrl: null, hasCustomLogo: false }
    },
    enabled: false, // Don't auto-fetch - use SSR data
  })
}

export function useUploadWorkspaceLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob): Promise<void> => {
      // Convert blob to base64
      const arrayBuffer = await file.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      const mimeType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

      const result = await uploadLogoAction({ data: { base64, mimeType } })
      if (!result.success) {
        throw new Error(result.error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.logo() })
    },
  })
}

export function useDeleteWorkspaceLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const result = await deleteLogoAction()
      if (!result.success) {
        throw new Error(result.error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.logo() })
    },
  })
}

// Header logo hooks (simplified)
export function useWorkspaceHeaderLogo() {
  return useQuery({
    queryKey: settingsKeys.headerLogo(),
    queryFn: async (): Promise<HeaderLogoData> => {
      return {
        headerLogoUrl: null,
        headerDisplayMode: null,
        headerDisplayName: null,
        hasCustomHeaderLogo: false,
      }
    },
    enabled: false,
  })
}

export function useUploadWorkspaceHeaderLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob): Promise<void> => {
      // Convert blob to base64
      const arrayBuffer = await file.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      const mimeType = file.type as 'image/jpeg' | 'image/png' | 'image/webp'

      const result = await uploadHeaderLogoAction({ data: { base64, mimeType } })
      if (!result.success) {
        throw new Error(result.error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.headerLogo() })
    },
  })
}

export function useDeleteWorkspaceHeaderLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const result = await deleteHeaderLogoAction()
      if (!result.success) {
        throw new Error(result.error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.headerLogo() })
    },
  })
}

export function useUpdateHeaderDisplayMode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (mode: string): Promise<void> => {
      const result = await updateHeaderDisplayModeAction({
        data: {
          mode: mode as 'logo_and_name' | 'logo_only' | 'custom_logo',
        },
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.headerLogo() })
    },
  })
}

export function useUpdateHeaderDisplayName() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string | null): Promise<void> => {
      const result = await updateHeaderDisplayNameAction({ data: { name } })
      if (!result.success) {
        throw new Error(result.error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.headerLogo() })
    },
  })
}
