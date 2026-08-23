/**
 * Settings mutations
 *
 * Mutation hooks for workspace settings (logo, header, etc.)
 * Uses same-origin `/api/storage` PUTs so a friendly URL rename cannot break uploads.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  deleteLogoFn,
  deleteHeaderLogoFn,
  updateHeaderDisplayModeFn,
  updateHeaderDisplayNameFn,
  saveLogoKeyFn,
  saveHeaderLogoKeyFn,
  saveFaviconKeyFn,
  saveWidgetHeroImageKeyFn,
  deleteWidgetHeroImageFn,
  updatePortalConfigFn,
  updateModerationDefaultFn,
  updateWidgetConfigFn,
  regenerateWidgetSecretFn,
  updateThemeFn,
  updateCustomCssFn,
  updateWorkflowAbandonedAutoCloseFn,
  updateWorkflowCloseSpamFn,
  updateDefaultSlaPolicyFn,
  updateSpamFilterConfigFn,
} from '@/lib/server/functions/settings'
import {
  updateHelpCenterConfigFn,
  updateHelpCenterSeoFn,
  enableHelpCenterLocaleFn,
  disableHelpCenterLocaleFn,
  updateHelpCenterLocaleChromeFn,
  updateHelpCenterAutoTranslateFn,
} from '@/lib/server/functions/help-center-settings'
import {
  updateHelpCenterDomainFn,
  verifyHelpCenterDomainFn,
} from '@/lib/server/functions/help-center-domain'
import {
  createRedirectRuleFn,
  deleteRedirectRuleFn,
} from '@/lib/server/functions/help-center-redirect-rules'
import {
  getLogoUploadUrlFn,
  getHeaderLogoUploadUrlFn,
  getWidgetHeroUploadUrlFn,
  getFaviconUploadUrlFn,
} from '@/lib/server/functions/uploads'
import { settingsQueries } from '@/lib/client/queries/settings'
import { downscaleSquareImage } from '@/lib/client/downscale-square-image'

// ============================================================================
// Logo Mutation Hooks
// ============================================================================

export function useUploadWorkspaceLogo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: Blob) => {
      const logoType = file.type || 'image/png'
      const faviconBlob = await downscaleSquareImage(file, 64)

      const [logoUpload, faviconUpload] = await Promise.all([
        getLogoUploadUrlFn({
          data: {
            filename: (file as File).name || 'logo.png',
            contentType: logoType,
            fileSize: file.size,
          },
        }),
        getFaviconUploadUrlFn({
          data: {
            filename: 'favicon.png',
            contentType: 'image/png',
            fileSize: faviconBlob.size,
          },
        }),
      ])

      const [logoResponse, faviconResponse] = await Promise.all([
        fetch(logoUpload.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': logoType },
        }),
        fetch(faviconUpload.uploadUrl, {
          method: 'PUT',
          body: faviconBlob,
          headers: { 'Content-Type': 'image/png' },
        }),
      ])

      if (!logoResponse.ok || !faviconResponse.ok) {
        throw new Error('Failed to upload logo to storage')
      }

      await saveLogoKeyFn({ data: { key: logoUpload.key } })
      await saveFaviconKeyFn({ data: { key: faviconUpload.key } })
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

// ============================================================================
// Widget Hero Image Mutation Hooks
// ============================================================================

export function useUploadWidgetHeroImage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: Blob) => {
      // 1. Get presigned URL from server
      const { uploadUrl, key } = await getWidgetHeroUploadUrlFn({
        data: {
          filename: (file as File).name || 'widget-hero.png',
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
        throw new Error('Failed to upload hero image to storage')
      }

      // 3. Save the S3 key (also switches the Home header style to 'image')
      await saveWidgetHeroImageKeyFn({ data: { key } })
    },
    onSuccess: () => {
      // Loaders read via ensureQueryData — invalidate AND return the promise
      // so callers awaiting the mutation see fresh config (see note above).
      return queryClient.invalidateQueries({ queryKey: settingsQueries.widgetConfig().queryKey })
    },
  })
}

export function useDeleteWidgetHeroImage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => deleteWidgetHeroImageFn(),
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: settingsQueries.widgetConfig().queryKey })
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
//
// Each onSuccess RETURNS the invalidate promise so the mutation stays pending
// until the refetch settles. Otherwise a fast navigate-away/back during the
// in-flight refetch would re-read the still-stale cache via `ensureQueryData`.
// ============================================================================

export function useUpdatePortalConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updatePortalConfigFn>[0]['data']) =>
      updatePortalConfigFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.portalConfig().queryKey }),
  })
}

export function useUpdateModerationDefault() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: NonNullable<Parameters<typeof updateModerationDefaultFn>[0]>['data']) =>
      updateModerationDefaultFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.portalConfig().queryKey }),
  })
}

export function useUpdateWidgetConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateWidgetConfigFn>[0]['data']) =>
      updateWidgetConfigFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.widgetConfig().queryKey }),
  })
}

export function useRegenerateWidgetSecret() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => regenerateWidgetSecretFn(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.widgetSecret().queryKey }),
  })
}

export function useUpdateSpamFilterConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateSpamFilterConfigFn>[0]['data']) =>
      updateSpamFilterConfigFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.spamFilterConfig().queryKey }),
  })
}

export function useUpdateHelpCenterConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateHelpCenterConfigFn>[0]['data']) =>
      updateHelpCenterConfigFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useUpdateHelpCenterSeo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateHelpCenterSeoFn>[0]['data']) =>
      updateHelpCenterSeoFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useEnableHelpCenterLocale() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof enableHelpCenterLocaleFn>[0]['data']) =>
      enableHelpCenterLocaleFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useDisableHelpCenterLocale() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (locale: Parameters<typeof disableHelpCenterLocaleFn>[0]['data']['locale']) =>
      disableHelpCenterLocaleFn({ data: { locale } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useUpdateHelpCenterLocaleChrome() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateHelpCenterLocaleChromeFn>[0]['data']) =>
      updateHelpCenterLocaleChromeFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useUpdateHelpCenterAutoTranslate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateHelpCenterAutoTranslateFn>[0]['data']) =>
      updateHelpCenterAutoTranslateFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useUpdateHelpCenterDomain() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (domain: string | null) => updateHelpCenterDomainFn({ data: { domain } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useVerifyHelpCenterDomain() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => verifyHelpCenterDomainFn({ data: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey })
      queryClient.invalidateQueries({
        queryKey: settingsQueries.helpCenterDomainStatus().queryKey,
      })
    },
  })
}

export function useCreateHelpCenterRedirectRule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof createRedirectRuleFn>[0]['data']) =>
      createRedirectRuleFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: settingsQueries.helpCenterRedirectRules().queryKey,
      }),
  })
}

export function useDeleteHelpCenterRedirectRule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteRedirectRuleFn({ data: { id } }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: settingsQueries.helpCenterRedirectRules().queryKey,
      }),
  })
}

export function useUpdateWorkflowAbandonedAutoClose() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateWorkflowAbandonedAutoCloseFn>[0]['data']) =>
      updateWorkflowAbandonedAutoCloseFn({ data }),
    onSuccess: (saved) =>
      queryClient.setQueryData(settingsQueries.workflowAbandonedAutoClose().queryKey, saved),
  })
}

export function useUpdateWorkflowCloseSpam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateWorkflowCloseSpamFn>[0]['data']) =>
      updateWorkflowCloseSpamFn({ data }),
    onSuccess: (saved) =>
      queryClient.setQueryData(settingsQueries.workflowCloseSpam().queryKey, saved),
  })
}

export function useUpdateDefaultSlaPolicy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof updateDefaultSlaPolicyFn>[0]['data']) =>
      updateDefaultSlaPolicyFn({ data }),
    onSuccess: (saved) =>
      queryClient.setQueryData(settingsQueries.defaultSlaPolicy().queryKey, saved),
  })
}

export function useSaveBrandingTheme() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      brandingConfig: Record<string, unknown>
      customCss: string
      /** Advanced CSS only. Generated theme CSS is reconstructed from brandingConfig. */
      persistCustomCss: boolean
    }) => {
      const { throwIfServerFnFailed } = await import('@/lib/shared/describe-upgrade')
      const theme = await updateThemeFn({ data: { brandingConfig: input.brandingConfig } })
      throwIfServerFnFailed(theme)
      if (!input.persistCustomCss) return [theme, null] as const
      const css = await updateCustomCssFn({ data: { customCss: input.customCss } })
      throwIfServerFnFailed(css)
      return [theme, css] as const
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsQueries.branding().queryKey }),
        queryClient.invalidateQueries({ queryKey: settingsQueries.customCss().queryKey }),
      ]),
  })
}
