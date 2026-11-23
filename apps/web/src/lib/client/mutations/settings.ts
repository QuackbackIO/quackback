/**
 * Settings mutations
 *
 * Mutation hooks for workspace settings (logo, header, etc.)
 * Uses same-origin `/api/storage` PUTs so a friendly URL rename cannot break uploads.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AUTOSAVE } from '@/lib/client/autosave'
import { isPlanRefusal } from '@/lib/shared/describe-upgrade'
import {
  deleteLogoFn,
  saveLogoKeyFn,
  saveFaviconKeyFn,
  saveWidgetHeroImageKeyFn,
  deleteWidgetHeroImageFn,
  updatePortalConfigFn,
  updateModerationDefaultFn,
  updateWidgetConfigFn,
  regenerateWidgetSecretFn,
  mintWidgetInstallCodeFn,
  updateWorkflowAbandonedAutoCloseFn,
  updateWorkflowCloseSpamFn,
  updateConversationRoutingFn,
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
  createRedirectRuleFn,
  deleteRedirectRuleFn,
} from '@/lib/server/functions/help-center-redirect-rules'
import {
  getLogoUploadUrlFn,
  getWidgetHeroUploadUrlFn,
  getFaviconUploadUrlFn,
} from '@/lib/server/functions/uploads'
import { publishPortalCustomisationFn } from '@/lib/server/functions/portal-customise'
import type { PublishPortalCustomisationInput } from '@/lib/shared/schemas/portal-customise'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
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

/**
 * `meta` overrides let a page that reports some failures itself (an upgrade
 * prompt) keep the shared toast for the rest.
 */
export function useUpdatePortalConfig(
  meta: { showServerMessage?: boolean; ownsError?: (error: unknown) => boolean } = {}
) {
  const queryClient = useQueryClient()

  return useMutation({
    meta: { ...AUTOSAVE, ...meta },
    mutationFn: (data: Parameters<typeof updatePortalConfigFn>[0]['data']) =>
      updatePortalConfigFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.portalConfig().queryKey }),
  })
}

export function useUpdateModerationDefault() {
  const queryClient = useQueryClient()

  return useMutation({
    meta: AUTOSAVE,
    mutationFn: (data: NonNullable<Parameters<typeof updateModerationDefaultFn>[0]>['data']) =>
      updateModerationDefaultFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.portalConfig().queryKey }),
  })
}

export function useUpdateWidgetConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    meta: AUTOSAVE,
    mutationFn: (data: Parameters<typeof updateWidgetConfigFn>[0]['data']) =>
      updateWidgetConfigFn({ data }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsQueries.widgetConfig().queryKey }),
        queryClient.invalidateQueries({ queryKey: adminQueries.onboardingStatus().queryKey }),
      ]),
  })
}

export function useRegenerateWidgetSecret() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => regenerateWidgetSecretFn(),
    onSuccess: (secret) => {
      queryClient.setQueryData(settingsQueries.widgetSecret().queryKey, secret)
      return queryClient.invalidateQueries({ queryKey: settingsQueries.widgetSecret().queryKey })
    },
  })
}

export function useMintWidgetInstallCode() {
  return useMutation({
    mutationFn: () => mintWidgetInstallCodeFn(),
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

/** The AI spam filter switch: autosaves like the other settings toggles. */
export function useUpdateSpamAiClassifier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (aiClassifier: boolean) => updateSpamFilterConfigFn({ data: { aiClassifier } }),
    meta: AUTOSAVE,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.spamFilterConfig().queryKey }),
  })
}

/**
 * Help Center config writes are read-merge-write on the server, so every
 * mutation that changes it shares one scope and runs after the previous one settles.
 */
const HELP_CENTER_CONFIG_SCOPE = { id: 'help-center-config' } as const

export function useUpdateHelpCenterConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    scope: HELP_CENTER_CONFIG_SCOPE,
    meta: AUTOSAVE,
    mutationFn: (data: Parameters<typeof updateHelpCenterConfigFn>[0]['data']) =>
      updateHelpCenterConfigFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useUpdateHelpCenterSeo() {
  const queryClient = useQueryClient()

  return useMutation({
    scope: HELP_CENTER_CONFIG_SCOPE,
    meta: AUTOSAVE,
    mutationFn: (data: Parameters<typeof updateHelpCenterSeoFn>[0]['data']) =>
      updateHelpCenterSeoFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useEnableHelpCenterLocale() {
  const queryClient = useQueryClient()

  return useMutation({
    scope: HELP_CENTER_CONFIG_SCOPE,
    mutationFn: (data: Parameters<typeof enableHelpCenterLocaleFn>[0]['data']) =>
      enableHelpCenterLocaleFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useDisableHelpCenterLocale() {
  const queryClient = useQueryClient()

  return useMutation({
    scope: HELP_CENTER_CONFIG_SCOPE,
    mutationFn: (locale: Parameters<typeof disableHelpCenterLocaleFn>[0]['data']['locale']) =>
      disableHelpCenterLocaleFn({ data: { locale } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useUpdateHelpCenterLocaleChrome() {
  const queryClient = useQueryClient()

  return useMutation({
    scope: HELP_CENTER_CONFIG_SCOPE,
    meta: AUTOSAVE,
    mutationFn: (data: Parameters<typeof updateHelpCenterLocaleChromeFn>[0]['data']) =>
      updateHelpCenterLocaleChromeFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
  })
}

export function useUpdateHelpCenterAutoTranslate() {
  const queryClient = useQueryClient()

  return useMutation({
    scope: HELP_CENTER_CONFIG_SCOPE,
    meta: AUTOSAVE,
    mutationFn: (data: Parameters<typeof updateHelpCenterAutoTranslateFn>[0]['data']) =>
      updateHelpCenterAutoTranslateFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueries.helpCenterConfig().queryKey }),
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
    meta: AUTOSAVE,
    mutationFn: (data: Parameters<typeof updateWorkflowAbandonedAutoCloseFn>[0]['data']) =>
      updateWorkflowAbandonedAutoCloseFn({ data }),
    onSuccess: (saved) =>
      queryClient.setQueryData(settingsQueries.workflowAbandonedAutoClose().queryKey, saved),
  })
}

export function useUpdateWorkflowCloseSpam() {
  const queryClient = useQueryClient()

  return useMutation({
    meta: AUTOSAVE,
    mutationFn: (data: Parameters<typeof updateWorkflowCloseSpamFn>[0]['data']) =>
      updateWorkflowCloseSpamFn({ data }),
    onSuccess: (saved) =>
      queryClient.setQueryData(settingsQueries.workflowCloseSpam().queryKey, saved),
  })
}

/** Autosave for the auto-assign switch on the Workflows page. */
export function useUpdateConversationRouting() {
  const queryClient = useQueryClient()

  return useMutation({
    meta: AUTOSAVE,
    mutationFn: (enabled: boolean) =>
      updateConversationRoutingFn({ data: { enabled, strategy: 'auto_assign_active' } }),
    onSuccess: (saved) =>
      queryClient.setQueryData(settingsQueries.conversationRouting().queryKey, saved),
  })
}

export function useUpdateDefaultSlaPolicy() {
  const queryClient = useQueryClient()

  return useMutation({
    meta: AUTOSAVE,
    mutationFn: (data: Parameters<typeof updateDefaultSlaPolicyFn>[0]['data']) =>
      updateDefaultSlaPolicyFn({ data }),
    onSuccess: (saved) =>
      queryClient.setQueryData(settingsQueries.defaultSlaPolicy().queryKey, saved),
  })
}

/**
 * The portal's one-step publish: theme, Advanced CSS, tabs and welcome
 * message (and, from the editor, Help Center home and wide logo) go live
 * together or not at all. Someone else's change to a sent part fails the
 * save with the server's sentence; the refusal rides on the error as
 * `conflict` for an editor that can offer to load their values.
 */
export function usePublishPortalCustomisation() {
  const queryClient = useQueryClient()

  return useMutation({
    // A plan refusal and someone else's change open the editor's own dialogs;
    // other refusals (a rejected stylesheet) are written for the admin, so the
    // toast names them.
    meta: {
      ...AUTOSAVE,
      showServerMessage: true,
      ownsError: (error) => isPlanRefusal(error) || !!(error as { conflict?: unknown }).conflict,
    },
    mutationFn: async (input: PublishPortalCustomisationInput) => {
      const { throwIfServerFnFailed } = await import('@/lib/shared/describe-upgrade')
      const result = await publishPortalCustomisationFn({ data: input })
      throwIfServerFnFailed(result)
      if (!result.ok) throw Object.assign(new Error(result.message), { conflict: result })
      return result
    },
    onSuccess: (_result, input) =>
      Promise.all([
        // Settings > Portal's summary reads the theme, the tabs and the logos.
        queryClient.invalidateQueries({ queryKey: ['settings', 'branding', 'summary'] }),
        ...(input.theme !== undefined
          ? [queryClient.invalidateQueries({ queryKey: settingsQueries.branding().queryKey })]
          : []),
        ...(input.customCss !== undefined
          ? [queryClient.invalidateQueries({ queryKey: settingsQueries.customCss().queryKey })]
          : []),
        ...(input.portal !== undefined
          ? [queryClient.invalidateQueries({ queryKey: settingsQueries.portalConfig().queryKey })]
          : []),
        ...(input.helpCenter !== undefined
          ? [
              queryClient.invalidateQueries({
                queryKey: settingsQueries.helpCenterConfig().queryKey,
              }),
            ]
          : []),
        ...(input.logo !== undefined
          ? [queryClient.invalidateQueries({ queryKey: settingsQueries.headerLogo().queryKey })]
          : []),
      ]),
  })
}
