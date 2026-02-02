/**
 * Settings mutations
 *
 * Mutation hooks for workspace settings (logo, header, etc.)
 * Uses presigned URLs for direct S3 uploads.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  deleteLogoFn,
  deleteHeaderLogoFn,
  updateHeaderDisplayModeFn,
  updateHeaderDisplayNameFn,
  saveLogoKeyFn,
  saveHeaderLogoKeyFn,
} from '@/lib/server/functions/settings'
import { getLogoUploadUrlFn, getHeaderLogoUploadUrlFn } from '@/lib/server/functions/uploads'
import { settingsQueries } from '@/lib/client/queries/settings'

// ============================================================================
// Logo Mutation Hooks
// ============================================================================

export function useUploadWorkspaceLogo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: Blob) => {
      // 1. Get presigned URL from server
      const { uploadUrl, key } = await getLogoUploadUrlFn({
        data: {
          filename: (file as File).name || 'logo.png',
          contentType: file.type,
          fileSize: file.size,
        },
      })

      // 2. Upload directly to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload logo to storage')
      }

      // 3. Save the S3 key to the database
      await saveLogoKeyFn({ data: { key } })
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
      // 1. Get presigned URL from server
      const { uploadUrl, key } = await getHeaderLogoUploadUrlFn({
        data: {
          filename: (file as File).name || 'header-logo.png',
          contentType: file.type,
          fileSize: file.size,
        },
      })

      // 2. Upload directly to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload header logo to storage')
      }

      // 3. Save the S3 key to the database
      await saveHeaderLogoKeyFn({ data: { key } })
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
