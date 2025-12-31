import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { db, member, user, invitation, eq, ne } from '@/lib/db'
import { getBulkUserAvatarData } from '@/lib/avatar'
import {
  updateCustomCss,
  updateBrandingConfig,
  updatePortalConfig,
  uploadLogo,
  deleteLogo,
  uploadHeaderLogo,
  deleteHeaderLogo,
  updateHeaderDisplayMode,
  updateHeaderDisplayName,
  type BrandingConfig,
  type UpdatePortalConfigInput,
} from '@/lib/settings'
import { getWorkspaceFeatures } from '@/lib/features/server'
import { userIdSchema, type UserId } from '@quackback/ids'

/**
 * Server functions for settings data fetching.
 * All functions require authentication.
 */

const fetchUserProfileSchema = userIdSchema

/**
 * Fetch team members and invitations for team settings page
 */
export const fetchTeamMembersAndInvitations = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    // Only show team members (owner, admin, member) - exclude portal users (role='user')
    const members = await db
      .select({
        id: member.id,
        role: member.role,
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(ne(member.role, 'user'))

    // Fetch pending invitations
    const pendingInvitations = await db.query.invitation.findMany({
      where: eq(invitation.status, 'pending'),
      orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
    })

    // Get avatar URLs for all team members (base64 for SSR)
    const userIds = members.map((m) => m.userId)
    const avatarMap = await getBulkUserAvatarData(userIds)

    // Format invitations for client component (TypeIDs come directly from DB)
    const formattedInvitations = pendingInvitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      name: inv.name,
      role: inv.role,
      createdAt: inv.createdAt.toISOString(),
      lastSentAt: inv.lastSentAt?.toISOString() || null,
      expiresAt: inv.expiresAt.toISOString(),
    }))

    return {
      members,
      avatarMap: Object.fromEntries(avatarMap),
      formattedInvitations,
    }
  }
)

/**
 * Fetch user profile data including avatar
 */
export const fetchUserProfile = createServerFn({ method: 'GET' })
  .inputValidator(fetchUserProfileSchema)
  .handler(async ({ data }: { data: UserId }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

    const userId = data
    // Fetch user's avatar data for SSR
    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, userId),
      columns: {
        imageBlob: true,
        imageType: true,
        image: true,
      },
    })

    const hasCustomAvatar = !!(userRecord?.imageBlob && userRecord?.imageType)
    // OAuth avatar URL (from GitHub, Google, etc.) - used as fallback
    const oauthAvatarUrl = userRecord?.image ?? null

    // Convert blob to base64 data URL for SSR - eliminates flicker
    // Custom blob avatar takes precedence over OAuth image URL
    let avatarUrl: string | null = null
    if (hasCustomAvatar && userRecord.imageBlob && userRecord.imageType) {
      const base64 = Buffer.from(userRecord.imageBlob).toString('base64')
      avatarUrl = `data:${userRecord.imageType};base64,${base64}`
    } else if (oauthAvatarUrl) {
      avatarUrl = oauthAvatarUrl
    }

    return {
      avatarUrl,
      oauthAvatarUrl,
      hasCustomAvatar,
    }
  })

// ============================================
// Schemas
// ============================================

const updateCustomCssSchema = z.object({
  customCss: z.string().nullable(),
})

const updateThemeSchema = z.object({
  brandingConfig: z.record(z.unknown()),
})

const updatePortalConfigSchema = z.object({
  oauth: z
    .object({
      google: z.boolean().optional(),
      github: z.boolean().optional(),
      microsoft: z.boolean().optional(),
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

// ============================================
// Type Exports
// ============================================

export type UpdateCustomCssInput = z.infer<typeof updateCustomCssSchema>
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>
export type UpdatePortalConfigActionInput = z.infer<typeof updatePortalConfigSchema>

// ============================================
// Write Operations
// ============================================

/**
 * Update custom CSS
 */
export const updateCustomCssFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCustomCssSchema)
  .handler(async ({ data }: { data: UpdateCustomCssInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const result = await updateCustomCss(data.customCss)
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })

/**
 * Update branding theme configuration
 */
export const updateThemeFn = createServerFn({ method: 'POST' })
  .inputValidator(updateThemeSchema)
  .handler(async ({ data }: { data: UpdateThemeInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const result = await updateBrandingConfig(data.brandingConfig as BrandingConfig)
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })

/**
 * Update portal configuration (OAuth, features)
 */
export const updatePortalConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalConfigSchema)
  .handler(async ({ data }: { data: UpdatePortalConfigActionInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const result = await updatePortalConfig(data as UpdatePortalConfigInput)
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })

/**
 * Get workspace features (edition, tier, enabled features, limits)
 */
export const getWorkspaceFeaturesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

  const features = await getWorkspaceFeatures()
  // Remove non-serializable hasFeature function
  return {
    edition: features.edition,
    tier: features.tier,
    enabledFeatures: features.enabledFeatures,
    limits: features.limits,
  }
})

// ============================================
// Logo Operations
// ============================================

const uploadLogoSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
})

const uploadHeaderLogoSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
})

const updateHeaderDisplayModeSchema = z.object({
  mode: z.enum(['logo_and_name', 'logo_only', 'custom_logo']),
})

const updateHeaderDisplayNameSchema = z.object({
  name: z.string().nullable(),
})

export type UploadLogoInput = z.infer<typeof uploadLogoSchema>
export type UploadHeaderLogoInput = z.infer<typeof uploadHeaderLogoSchema>
export type UpdateHeaderDisplayModeInput = z.infer<typeof updateHeaderDisplayModeSchema>
export type UpdateHeaderDisplayNameInput = z.infer<typeof updateHeaderDisplayNameSchema>

/**
 * Upload logo (square logo for favicon and compact display)
 */
export const uploadLogoFn = createServerFn({ method: 'POST' })
  .inputValidator(uploadLogoSchema)
  .handler(async ({ data }: { data: UploadLogoInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const blob = Buffer.from(data.base64, 'base64')
    const result = await uploadLogo({
      blob,
      mimeType: data.mimeType,
    })
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })

/**
 * Delete logo
 */
export const deleteLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin'] })

  const result = await deleteLogo()
  if (!result.success) throw new Error(result.error.message)
  return result.value
})

/**
 * Upload header logo (horizontal wordmark/lockup)
 */
export const uploadHeaderLogoFn = createServerFn({ method: 'POST' })
  .inputValidator(uploadHeaderLogoSchema)
  .handler(async ({ data }: { data: UploadHeaderLogoInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const blob = Buffer.from(data.base64, 'base64')
    const result = await uploadHeaderLogo({
      blob,
      mimeType: data.mimeType,
    })
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })

/**
 * Delete header logo
 */
export const deleteHeaderLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin'] })

  const result = await deleteHeaderLogo()
  if (!result.success) throw new Error(result.error.message)
  return result.value
})

/**
 * Update header display mode
 */
export const updateHeaderDisplayModeFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayModeSchema)
  .handler(async ({ data }: { data: UpdateHeaderDisplayModeInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const result = await updateHeaderDisplayMode(data.mode)
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })

/**
 * Update header display name
 */
export const updateHeaderDisplayNameFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayNameSchema)
  .handler(async ({ data }: { data: UpdateHeaderDisplayNameInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const result = await updateHeaderDisplayName(data.name)
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })
