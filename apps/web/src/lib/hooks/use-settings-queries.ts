import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  uploadLogoFn,
  deleteLogoFn,
  uploadHeaderLogoFn,
  deleteHeaderLogoFn,
  updateHeaderDisplayModeFn,
  updateHeaderDisplayNameFn,
} from '@/lib/server-functions/settings'
import { settingsQueries } from '@/lib/queries/settings'

// Re-export query hooks that use the centralized settingsQueries
export function useWorkspaceLogo() {
  return useQuery({
    ...settingsQueries.logo(),
    enabled: false, // Use SSR data, don't auto-fetch
  })
}

export function useWorkspaceHeaderLogo() {
  return useQuery({
    ...settingsQueries.headerLogo(),
    enabled: false, // Use SSR data, don't auto-fetch
  })
}

// Helper to convert ArrayBuffer to base64 (browser-compatible)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Mutation hooks
export function useUploadWorkspaceLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob): Promise<void> => {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)
      const mimeType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      await uploadLogoFn({ data: { base64, mimeType } })
    },
    onSuccess: () => {
      // Use refetchQueries to force refetch even with enabled: false
      queryClient.refetchQueries({ queryKey: settingsQueries.logo().queryKey })
    },
  })
}

export function useDeleteWorkspaceLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await deleteLogoFn()
    },
    onSuccess: () => {
      // Use refetchQueries to force refetch even with enabled: false
      queryClient.refetchQueries({ queryKey: settingsQueries.logo().queryKey })
    },
  })
}

export function useUploadWorkspaceHeaderLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob): Promise<void> => {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)
      const mimeType = file.type as 'image/jpeg' | 'image/png' | 'image/webp'
      await uploadHeaderLogoFn({ data: { base64, mimeType } })
    },
    onSuccess: () => {
      // Use refetchQueries to force refetch even with enabled: false
      queryClient.refetchQueries({ queryKey: settingsQueries.headerLogo().queryKey })
    },
  })
}

export function useDeleteWorkspaceHeaderLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await deleteHeaderLogoFn()
    },
    onSuccess: () => {
      // Use refetchQueries to force refetch even with enabled: false
      queryClient.refetchQueries({ queryKey: settingsQueries.headerLogo().queryKey })
    },
  })
}

export function useUpdateHeaderDisplayMode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (mode: string): Promise<void> => {
      await updateHeaderDisplayModeFn({
        data: {
          mode: mode as 'logo_and_name' | 'logo_only' | 'custom_logo',
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.headerLogo().queryKey })
    },
  })
}

export function useUpdateHeaderDisplayName() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string | null): Promise<void> => {
      await updateHeaderDisplayNameFn({ data: { name } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.headerLogo().queryKey })
    },
  })
}
