/**
 * Settings mutations
 *
 * Mutation hooks for workspace settings (logo, header, etc.)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  uploadLogoFn,
  deleteLogoFn,
  uploadHeaderLogoFn,
  deleteHeaderLogoFn,
  updateHeaderDisplayModeFn,
  updateHeaderDisplayNameFn,
} from '@/lib/server/functions/settings'
import { settingsQueries } from '@/lib/client/queries/settings'

// ============================================================================
// Helpers
// ============================================================================

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// ============================================================================
// Logo Mutation Hooks
// ============================================================================

export function useUploadWorkspaceLogo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: Blob) => {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)
      const mimeType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      await uploadLogoFn({ data: { base64, mimeType } })
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: settingsQueries.logo().queryKey })
    },
  })
}

export function useDeleteWorkspaceLogo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => deleteLogoFn(),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: settingsQueries.logo().queryKey })
    },
  })
}

// ============================================================================
// Header Logo Mutation Hooks
// ============================================================================

export function useUploadWorkspaceHeaderLogo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: Blob) => {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)
      const mimeType = file.type as 'image/jpeg' | 'image/png' | 'image/webp'
      await uploadHeaderLogoFn({ data: { base64, mimeType } })
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: settingsQueries.headerLogo().queryKey })
    },
  })
}

export function useDeleteWorkspaceHeaderLogo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => deleteHeaderLogoFn(),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: settingsQueries.headerLogo().queryKey })
    },
  })
}

export function useUpdateHeaderDisplayMode() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (mode: 'logo_and_name' | 'logo_only' | 'custom_logo') =>
      updateHeaderDisplayModeFn({ data: { mode } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.headerLogo().queryKey })
    },
  })
}

export function useUpdateHeaderDisplayName() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string | null) => updateHeaderDisplayNameFn({ data: { name } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.headerLogo().queryKey })
    },
  })
}
