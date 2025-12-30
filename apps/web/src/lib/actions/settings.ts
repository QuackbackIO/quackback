import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'
import { getWorkspaceFeatures } from '@/lib/features/server'
import type { Feature, PricingTier, TierLimits } from '@/lib/features'
import type { UserId } from '@quackback/ids'
import {
  getPortalConfig,
  updatePortalConfig,
  getBrandingConfig,
  updateBrandingConfig,
  getCustomCss,
  updateCustomCss,
  uploadLogo,
  deleteLogo,
  uploadHeaderLogo,
  deleteHeaderLogo,
  updateHeaderDisplayMode,
  updateHeaderDisplayName,
  getAuthConfig,
  updateAuthConfig,
  type BrandingConfig,
} from '@/lib/settings'

// ============================================
// Schemas
// ============================================

const _getWorkspaceFeaturesSchema = z.object({})

const _getPortalConfigSchema = z.object({})

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

const _getThemeSchema = z.object({})

const updateThemeSchema = z.object({
  brandingConfig: z.record(z.string(), z.unknown()),
})

const _getCustomCssSchema = z.object({})

const updateCustomCssSchema = z.object({
  customCss: z.string().nullable(),
})

const uploadLogoSchema = z.object({
  base64: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
})

const _deleteLogoSchema = z.object({})

const uploadHeaderLogoSchema = z.object({
  base64: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
})

const _deleteHeaderLogoSchema = z.object({})

const updateHeaderDisplayModeSchema = z.object({
  mode: z.enum(['logo_and_name', 'logo_only', 'custom_logo']),
})

const updateHeaderDisplayNameSchema = z.object({
  name: z.string().max(100).nullable(),
})

const _getSecuritySchema = z.object({})

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

export type GetWorkspaceFeaturesInput = z.infer<typeof _getWorkspaceFeaturesSchema>
export type GetPortalConfigInput = z.infer<typeof _getPortalConfigSchema>
export type UpdatePortalConfigInput = z.infer<typeof updatePortalConfigSchema>
export type GetThemeInput = z.infer<typeof _getThemeSchema>
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>
export type GetCustomCssInput = z.infer<typeof _getCustomCssSchema>
export type UpdateCustomCssInput = z.infer<typeof updateCustomCssSchema>
export type UploadLogoInput = z.infer<typeof uploadLogoSchema>
export type DeleteLogoInput = z.infer<typeof _deleteLogoSchema>
export type UploadHeaderLogoInput = z.infer<typeof uploadHeaderLogoSchema>
export type DeleteHeaderLogoInput = z.infer<typeof _deleteHeaderLogoSchema>
export type UpdateHeaderDisplayModeInput = z.infer<typeof updateHeaderDisplayModeSchema>
export type UpdateHeaderDisplayNameInput = z.infer<typeof updateHeaderDisplayNameSchema>
export type GetSecurityInput = z.infer<typeof _getSecuritySchema>
export type UpdateSecurityInput = z.infer<typeof updateSecuritySchema>

// ============================================
// Actions
// ============================================

/**
 * Get workspace feature access info.
 */
export const getWorkspaceFeaturesAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<
    ActionResult<{
      edition: 'oss' | 'cloud'
      tier: PricingTier
      enabledFeatures: Feature[]
      limits: TierLimits
    }>
  > => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

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
export const getPortalConfigAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<
    ActionResult<{
      oauth: { google: boolean; github: boolean }
      features: {
        publicView: boolean
        submissions: boolean
        comments: boolean
        voting: boolean
      }
    }>
  > => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await getPortalConfig()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({
      oauth: result.value.oauth,
      features: result.value.features,
    })
  }
)

/**
 * Update portal configuration.
 */
export const updatePortalConfigAction = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalConfigSchema)
  .handler(
    async ({
      data: input,
    }): Promise<
      ActionResult<{
        oauth: { google: boolean; github: boolean }
        features: {
          publicView: boolean
          submissions: boolean
          comments: boolean
          voting: boolean
        }
      }>
    > => {
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
      }

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id as UserId),
      })
      if (!memberRecord) {
        return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
      }

      if (!['owner', 'admin'].includes(memberRecord.role)) {
        return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
      }

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

      const result = await updatePortalConfig(updateInput)
      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk({
        oauth: result.value.oauth,
        features: result.value.features,
      })
    }
  )

/**
 * Get branding/theme configuration.
 */
export const getThemeAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<{ brandingConfig: BrandingConfig }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await getBrandingConfig()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ brandingConfig: result.value })
  }
)

/**
 * Update branding/theme configuration.
 */
export const updateThemeAction = createServerFn({ method: 'POST' })
  .inputValidator(updateThemeSchema)
  .handler(async ({ data }): Promise<ActionResult<{ brandingConfig: BrandingConfig }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await updateBrandingConfig((data.brandingConfig || {}) as BrandingConfig)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ brandingConfig: result.value })
  })

/**
 * Get custom CSS.
 */
export const getCustomCssAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<{ customCss: string | null }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await getCustomCss()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ customCss: result.value })
  }
)

/**
 * Update custom CSS.
 */
export const updateCustomCssAction = createServerFn({ method: 'POST' })
  .inputValidator(updateCustomCssSchema)
  .handler(async ({ data }): Promise<ActionResult<{ customCss: string | null }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await updateCustomCss(data.customCss)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ customCss: result.value })
  })

/**
 * Upload logo (square logo for favicon/compact display).
 */
export const uploadLogoAction = createServerFn({ method: 'POST' })
  .inputValidator(uploadLogoSchema)
  .handler(async ({ data }): Promise<ActionResult<{ success: true }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const blob = Buffer.from(data.base64, 'base64')
    const result = await uploadLogo({ blob, mimeType: data.mimeType })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  })

/**
 * Delete logo.
 */
export const deleteLogoAction = createServerFn({ method: 'POST' }).handler(
  async (): Promise<ActionResult<{ success: true }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await deleteLogo()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  }
)

/**
 * Upload header logo (horizontal wordmark/lockup).
 */
export const uploadHeaderLogoAction = createServerFn({ method: 'POST' })
  .inputValidator(uploadHeaderLogoSchema)
  .handler(async ({ data }): Promise<ActionResult<{ success: true }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const blob = Buffer.from(data.base64, 'base64')
    const result = await uploadHeaderLogo({ blob, mimeType: data.mimeType })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  })

/**
 * Delete header logo.
 */
export const deleteHeaderLogoAction = createServerFn({ method: 'POST' }).handler(
  async (): Promise<ActionResult<{ success: true }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await deleteHeaderLogo()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  }
)

/**
 * Update header display mode.
 */
export const updateHeaderDisplayModeAction = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayModeSchema)
  .handler(
    async ({
      data,
    }): Promise<ActionResult<{ mode: 'logo_and_name' | 'logo_only' | 'custom_logo' }>> => {
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
      }

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id as UserId),
      })
      if (!memberRecord) {
        return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
      }

      if (!['owner', 'admin'].includes(memberRecord.role)) {
        return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
      }

      const result = await updateHeaderDisplayMode(data.mode)
      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }
      return actionOk({ mode: result.value as 'logo_and_name' | 'logo_only' | 'custom_logo' })
    }
  )

/**
 * Update header display name.
 */
export const updateHeaderDisplayNameAction = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayNameSchema)
  .handler(async ({ data }): Promise<ActionResult<{ name: string | null }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await updateHeaderDisplayName(data.name)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ name: result.value })
  })

/**
 * Get security/auth configuration.
 */
export const getSecurityAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<
    ActionResult<{
      oauth: { google: boolean; github: boolean; microsoft: boolean }
      openSignup: boolean
    }>
  > => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await getAuthConfig()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({
      oauth: result.value.oauth,
      openSignup: result.value.openSignup,
    })
  }
)

/**
 * Update security/auth configuration.
 */
export const updateSecurityAction = createServerFn({ method: 'POST' })
  .inputValidator(updateSecuritySchema)
  .handler(
    async ({
      data: input,
    }): Promise<
      ActionResult<{
        oauth: { google: boolean; github: boolean; microsoft: boolean }
        openSignup: boolean
      }>
    > => {
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
      }

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id as UserId),
      })
      if (!memberRecord) {
        return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
      }

      if (!['owner', 'admin'].includes(memberRecord.role)) {
        return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
      }

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

      const result = await updateAuthConfig(updateInput)
      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk({
        oauth: result.value.oauth,
        openSignup: result.value.openSignup,
      })
    }
  )
