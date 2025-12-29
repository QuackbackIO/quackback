'use server'

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
export async function getWorkspaceFeaturesAction(): Promise<
  ActionResult<{
    edition: 'oss' | 'cloud'
    tier: PricingTier
    enabledFeatures: Feature[]
    limits: TierLimits
  }>
> {
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

/**
 * Get portal configuration.
 */
export async function getPortalConfigAction(): Promise<
  ActionResult<{
    oauth: { google: boolean; github: boolean }
    features: {
      publicView: boolean
      submissions: boolean
      comments: boolean
      voting: boolean
    }
  }>
> {
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

/**
 * Update portal configuration.
 */
export async function updatePortalConfigAction(rawInput: unknown): Promise<
  ActionResult<{
    oauth: { google: boolean; github: boolean }
    features: {
      publicView: boolean
      submissions: boolean
      comments: boolean
      voting: boolean
    }
  }>
> {
  const parsed = updatePortalConfigSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const input = parsed.data
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

/**
 * Get branding/theme configuration.
 */
export async function getThemeAction(): Promise<ActionResult<{ brandingConfig: BrandingConfig }>> {
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

/**
 * Update branding/theme configuration.
 */
export async function updateThemeAction(
  rawInput: unknown
): Promise<ActionResult<{ brandingConfig: BrandingConfig }>> {
  const parsed = updateThemeSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await updateBrandingConfig((parsed.data.brandingConfig || {}) as BrandingConfig)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ brandingConfig: result.value })
}

/**
 * Get custom CSS.
 */
export async function getCustomCssAction(): Promise<ActionResult<{ customCss: string | null }>> {
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

/**
 * Update custom CSS.
 */
export async function updateCustomCssAction(
  rawInput: unknown
): Promise<ActionResult<{ customCss: string | null }>> {
  const parsed = updateCustomCssSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await updateCustomCss(parsed.data.customCss)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ customCss: result.value })
}

/**
 * Upload logo (square logo for favicon/compact display).
 */
export async function uploadLogoAction(
  rawInput: unknown
): Promise<ActionResult<{ success: true }>> {
  const parsed = uploadLogoSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const blob = Buffer.from(parsed.data.base64, 'base64')
  const result = await uploadLogo({ blob, mimeType: parsed.data.mimeType })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ success: true })
}

/**
 * Delete logo.
 */
export async function deleteLogoAction(): Promise<ActionResult<{ success: true }>> {
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

/**
 * Upload header logo (horizontal wordmark/lockup).
 */
export async function uploadHeaderLogoAction(
  rawInput: unknown
): Promise<ActionResult<{ success: true }>> {
  const parsed = uploadHeaderLogoSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const blob = Buffer.from(parsed.data.base64, 'base64')
  const result = await uploadHeaderLogo({ blob, mimeType: parsed.data.mimeType })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ success: true })
}

/**
 * Delete header logo.
 */
export async function deleteHeaderLogoAction(): Promise<ActionResult<{ success: true }>> {
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

/**
 * Update header display mode.
 */
export async function updateHeaderDisplayModeAction(
  rawInput: unknown
): Promise<ActionResult<{ mode: 'logo_and_name' | 'logo_only' | 'custom_logo' }>> {
  const parsed = updateHeaderDisplayModeSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await updateHeaderDisplayMode(parsed.data.mode)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ mode: result.value as 'logo_and_name' | 'logo_only' | 'custom_logo' })
}

/**
 * Update header display name.
 */
export async function updateHeaderDisplayNameAction(
  rawInput: unknown
): Promise<ActionResult<{ name: string | null }>> {
  const parsed = updateHeaderDisplayNameSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await updateHeaderDisplayName(parsed.data.name)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ name: result.value })
}

/**
 * Get security/auth configuration.
 */
export async function getSecurityAction(): Promise<
  ActionResult<{
    oauth: { google: boolean; github: boolean; microsoft: boolean }
    openSignup: boolean
  }>
> {
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

/**
 * Update security/auth configuration.
 */
export async function updateSecurityAction(rawInput: unknown): Promise<
  ActionResult<{
    oauth: { google: boolean; github: boolean; microsoft: boolean }
    openSignup: boolean
  }>
> {
  const parsed = updateSecuritySchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const input = parsed.data
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
