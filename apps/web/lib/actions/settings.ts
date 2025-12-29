'use server'

import { z } from 'zod'
import { withAction, mapDomainError } from './with-action'
import { actionOk, actionErr } from './types'
import { getWorkspaceFeatures } from '@/lib/features/server'
import { settingsService, type BrandingConfig } from '@quackback/domain'

// ============================================
// Schemas
// ============================================

const getWorkspaceFeaturesSchema = z.object({})

const getPortalConfigSchema = z.object({})

const updatePortalConfigSchema = z.object({
  oauth: z
    .object({
      google: z.boolean().optional(),
      github: z.boolean().optional(),
    })
    .optional(),
  features: z
    .object({
      publicView: z.boolean().optional(),
      submissions: z.boolean().optional(),
      comments: z.boolean().optional(),
      voting: z.boolean().optional(),
    })
    .optional(),
})

const getThemeSchema = z.object({})

const updateThemeSchema = z.object({
  brandingConfig: z.record(z.string(), z.unknown()),
})

const getCustomCssSchema = z.object({})

const updateCustomCssSchema = z.object({
  customCss: z.string().nullable(),
})

const uploadLogoSchema = z.object({
  base64: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
})

const deleteLogoSchema = z.object({})

const uploadHeaderLogoSchema = z.object({
  base64: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
})

const deleteHeaderLogoSchema = z.object({})

const updateHeaderDisplayModeSchema = z.object({
  mode: z.enum(['logo_and_name', 'logo_only', 'custom_logo']),
})

const updateHeaderDisplayNameSchema = z.object({
  name: z.string().max(100).nullable(),
})

const getSecuritySchema = z.object({})

const updateSecuritySchema = z.object({
  oauth: z
    .object({
      google: z.boolean().optional(),
      github: z.boolean().optional(),
      microsoft: z.boolean().optional(),
    })
    .optional(),
  openSignup: z.boolean().optional(),
})

// ============================================
// Type Exports
// ============================================

export type GetWorkspaceFeaturesInput = z.infer<typeof getWorkspaceFeaturesSchema>
export type GetPortalConfigInput = z.infer<typeof getPortalConfigSchema>
export type UpdatePortalConfigInput = z.infer<typeof updatePortalConfigSchema>
export type GetThemeInput = z.infer<typeof getThemeSchema>
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>
export type GetCustomCssInput = z.infer<typeof getCustomCssSchema>
export type UpdateCustomCssInput = z.infer<typeof updateCustomCssSchema>
export type UploadLogoInput = z.infer<typeof uploadLogoSchema>
export type DeleteLogoInput = z.infer<typeof deleteLogoSchema>
export type UploadHeaderLogoInput = z.infer<typeof uploadHeaderLogoSchema>
export type DeleteHeaderLogoInput = z.infer<typeof deleteHeaderLogoSchema>
export type UpdateHeaderDisplayModeInput = z.infer<typeof updateHeaderDisplayModeSchema>
export type UpdateHeaderDisplayNameInput = z.infer<typeof updateHeaderDisplayNameSchema>
export type GetSecurityInput = z.infer<typeof getSecuritySchema>
export type UpdateSecurityInput = z.infer<typeof updateSecuritySchema>

// ============================================
// Actions
// ============================================

/**
 * Get workspace feature access info.
 */
export const getWorkspaceFeaturesAction = withAction(
  getWorkspaceFeaturesSchema,
  async (_input, _ctx) => {
    const features = await getWorkspaceFeatures()
    return actionOk({
      edition: features.edition,
      tier: features.tier,
      enabledFeatures: features.enabledFeatures,
      limits: features.limits,
    })
  }
)

/**
 * Get portal configuration.
 */
export const getPortalConfigAction = withAction(
  getPortalConfigSchema,
  async (_input, _ctx) => {
    const result = await settingsService.getPortalConfig()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({
      oauth: result.value.oauth,
      features: result.value.features,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update portal configuration.
 */
export const updatePortalConfigAction = withAction(
  updatePortalConfigSchema,
  async (input, _ctx, serviceCtx) => {
    const updateInput: {
      oauth?: { google?: boolean; github?: boolean }
      features?: {
        publicView?: boolean
        submissions?: boolean
        comments?: boolean
        voting?: boolean
      }
    } = {}

    if (input.oauth) {
      updateInput.oauth = {}
      if (typeof input.oauth.google === 'boolean') updateInput.oauth.google = input.oauth.google
      if (typeof input.oauth.github === 'boolean') updateInput.oauth.github = input.oauth.github
    }

    if (input.features) {
      updateInput.features = {}
      if (typeof input.features.publicView === 'boolean')
        updateInput.features.publicView = input.features.publicView
      if (typeof input.features.submissions === 'boolean')
        updateInput.features.submissions = input.features.submissions
      if (typeof input.features.comments === 'boolean')
        updateInput.features.comments = input.features.comments
      if (typeof input.features.voting === 'boolean')
        updateInput.features.voting = input.features.voting
    }

    if (Object.keys(updateInput).length === 0) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: 'At least one setting must be provided',
        status: 400,
      })
    }

    const result = await settingsService.updatePortalConfig(updateInput, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk({
      oauth: result.value.oauth,
      features: result.value.features,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Get branding/theme configuration.
 */
export const getThemeAction = withAction(
  getThemeSchema,
  async (_input, _ctx) => {
    const result = await settingsService.getBrandingConfig()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ brandingConfig: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update branding/theme configuration.
 */
export const updateThemeAction = withAction(
  updateThemeSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await settingsService.updateBrandingConfig(
      (input.brandingConfig || {}) as BrandingConfig,
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ brandingConfig: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Get custom CSS.
 */
export const getCustomCssAction = withAction(
  getCustomCssSchema,
  async (_input, _ctx) => {
    const result = await settingsService.getCustomCss()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ customCss: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update custom CSS.
 */
export const updateCustomCssAction = withAction(
  updateCustomCssSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await settingsService.updateCustomCss(input.customCss, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ customCss: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Upload logo (square logo for favicon/compact display).
 */
export const uploadLogoAction = withAction(
  uploadLogoSchema,
  async (input, _ctx, serviceCtx) => {
    const blob = Buffer.from(input.base64, 'base64')
    const result = await settingsService.uploadLogo({ blob, mimeType: input.mimeType }, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Delete logo.
 */
export const deleteLogoAction = withAction(
  deleteLogoSchema,
  async (_input, _ctx, serviceCtx) => {
    const result = await settingsService.deleteLogo(serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Upload header logo (horizontal wordmark/lockup).
 */
export const uploadHeaderLogoAction = withAction(
  uploadHeaderLogoSchema,
  async (input, _ctx, serviceCtx) => {
    const blob = Buffer.from(input.base64, 'base64')
    const result = await settingsService.uploadHeaderLogo(
      { blob, mimeType: input.mimeType },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Delete header logo.
 */
export const deleteHeaderLogoAction = withAction(
  deleteHeaderLogoSchema,
  async (_input, _ctx, serviceCtx) => {
    const result = await settingsService.deleteHeaderLogo(serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update header display mode.
 */
export const updateHeaderDisplayModeAction = withAction(
  updateHeaderDisplayModeSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await settingsService.updateHeaderDisplayMode(input.mode, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ mode: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update header display name.
 */
export const updateHeaderDisplayNameAction = withAction(
  updateHeaderDisplayNameSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await settingsService.updateHeaderDisplayName(input.name, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ name: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Get security/auth configuration.
 */
export const getSecurityAction = withAction(
  getSecuritySchema,
  async (_input, _ctx) => {
    const result = await settingsService.getAuthConfig()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({
      oauth: result.value.oauth,
      openSignup: result.value.openSignup,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update security/auth configuration.
 */
export const updateSecurityAction = withAction(
  updateSecuritySchema,
  async (input, _ctx, serviceCtx) => {
    const updateInput: {
      oauth?: { google?: boolean; github?: boolean; microsoft?: boolean }
      openSignup?: boolean
    } = {}

    if (input.oauth) {
      updateInput.oauth = {}
      if (typeof input.oauth.google === 'boolean') updateInput.oauth.google = input.oauth.google
      if (typeof input.oauth.github === 'boolean') updateInput.oauth.github = input.oauth.github
      if (typeof input.oauth.microsoft === 'boolean')
        updateInput.oauth.microsoft = input.oauth.microsoft
    }
    if (typeof input.openSignup === 'boolean') {
      updateInput.openSignup = input.openSignup
    }

    if (Object.keys(updateInput).length === 0) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: 'At least one setting must be provided',
        status: 400,
      })
    }

    const result = await settingsService.updateAuthConfig(updateInput, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk({
      oauth: result.value.oauth,
      openSignup: result.value.openSignup,
    })
  },
  { roles: ['owner', 'admin'] }
)
