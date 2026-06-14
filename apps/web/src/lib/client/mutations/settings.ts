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
  updatePortalConfigFn,
  updateModerationDefaultFn,
  updateWidgetConfigFn,
  regenerateWidgetSecretFn,
  updateThemeFn,
  updateCustomCssFn,
} from '@/lib/server/functions/settings'
import { updateHelpCenterConfigFn } from '@/lib/server/functions/help-center-settings'
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

// ============================================================================
// Portal / widget / help-center config mutation hooks
//
// These configs are read via `settingsQueries.*` with a long staleTime, and the
// route loaders warm them with `ensureQueryData` (which returns the cached value
// without refetching a stale entry). So a write must invalidate its query, or the
// loader-warmed cache keeps serving the pre-save value and settings pages that
// seed `useState` from it revert on the next visit until a hard reload.
// `router.invalidate()` alone does NOT fix this — it re-runs the same cached loader.
// ============================================================================

export function useUpdatePortalConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updatePortalConfigFn>[0]['data']) =>
      updatePortalConfigFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.portalConfig().queryKey })
    },
  })
}

export function useUpdateModerationDefault() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: NonNullable<Parameters<typeof updateModerationDefaultFn>[0]>['data']) =>
      updateModerationDefaultFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.portalConfig().queryKey })
    },
  })
}

export function useUpdateWidgetConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateWidgetConfigFn>[0]['data']) =>
      updateWidgetConfigFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.widgetConfig().queryKey })
    },
  })
}

export function useRegenerateWidgetSecret() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => regenerateWidgetSecretFn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.widgetSecret().queryKey })
    },
  })
}

export function useUpdateHelpCenterConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateHelpCenterConfigFn>[0]['data']) =>
      updateHelpCenterConfigFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey })
    },
  })
}

export function useSaveBrandingTheme() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { brandingConfig: Record<string, unknown>; customCss: string }) =>
      Promise.all([
        updateThemeFn({ data: { brandingConfig: input.brandingConfig } }),
        updateCustomCssFn({ data: { customCss: input.customCss } }),
      ]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.branding().queryKey })
      queryClient.invalidateQueries({ queryKey: settingsQueries.customCss().queryKey })
    },
  })
}
