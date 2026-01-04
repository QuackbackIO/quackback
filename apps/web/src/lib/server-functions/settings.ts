import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
// Import types from barrel export (client-safe)
import {
  DEFAULT_PORTAL_CONFIG,
  type BrandingConfig,
  type UpdatePortalConfigInput,
} from '@/lib/settings'
import { userIdSchema, type UserId } from '@quackback/ids'

/**
 * Server functions for settings data fetching.
 * All functions require authentication.
 *
 * NOTE: All DB and server-only imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 */

// ============================================
// Read Operations (public - no auth required)
// ============================================

/**
 * Get workspace features and tier information
 * Used by useWorkspaceFeatures hook for feature gating
 */
export const getWorkspaceFeaturesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getWorkspaceFeatures } = await import('@/lib/features/server')
  const features = await getWorkspaceFeatures()

  // Return serializable data (remove function)
  return {
    edition: features.edition,
    selfHostedTier: features.selfHostedTier,
    cloudTier: features.cloudTier,
    enabledFeatures: features.enabledFeatures,
    limits: features.limits,
    hasEnterprise: features.hasEnterprise,
    license: features.license,
  }
})

/**
 * Fetch branding configuration (public - used for theming)
 */
export const fetchBrandingConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { getBrandingConfig } = await import('@/lib/settings/settings.service')

  return await getBrandingConfig()
})

/**
 * Fetch custom CSS (public - used for portal styling)
 */
export const fetchCustomCss = createServerFn({ method: 'GET' }).handler(async () => {
  const { getCustomCss } = await import('@/lib/settings/settings.service')

  return await getCustomCss()
})

/**
 * Fetch portal configuration (admin - full config)
 */
export const fetchPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { getPortalConfig } = await import('@/lib/settings/settings.service')

  const config = await getPortalConfig()
  return config ?? DEFAULT_PORTAL_CONFIG
})

/**
 * Fetch public portal configuration (public - for login pages)
 */
export const fetchPublicPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { getPublicPortalConfig } = await import('@/lib/settings/settings.service')

  return await getPublicPortalConfig()
})

/**
 * Fetch public auth configuration (public - for admin login)
 */
export const fetchPublicAuthConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { getPublicAuthConfig } = await import('@/lib/settings/settings.service')

  return await getPublicAuthConfig()
})

const fetchUserProfileSchema = userIdSchema

/**
 * Fetch team members and invitations for team settings page
 */
export const fetchTeamMembersAndInvitations = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { requireAuth } = await import('./auth-helpers')
    const { db, member, user, invitation, eq, ne } = await import('@/lib/db')

    await requireAuth({ roles: ['admin', 'member'] })

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

    // Fetch avatars inline
    const avatarMap = new Map<UserId, string | null>()
    if (userIds.length > 0) {
      const users = await db.query.user.findMany({
        where: (users, { inArray }) => inArray(users.id, userIds),
        columns: {
          id: true,
          imageBlob: true,
          imageType: true,
          image: true,
        },
      })

      for (const u of users) {
        if (u.imageBlob && u.imageType) {
          const base64 = Buffer.from(u.imageBlob).toString('base64')
          avatarMap.set(u.id, `data:${u.imageType};base64,${base64}`)
        } else {
          avatarMap.set(u.id, u.image)
        }
      }

      // Fill in null for any users not found
      for (const userId of userIds) {
        if (!avatarMap.has(userId)) {
          avatarMap.set(userId, null)
        }
      }
    }

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
 * Fetch user profile data including avatar.
 * Only requires authentication - any logged-in user can view their own profile.
 */
export const fetchUserProfile = createServerFn({ method: 'GET' })
  .inputValidator(fetchUserProfileSchema)
  .handler(async ({ data }) => {
    const { getSession } = await import('./auth')
    const { db, user, eq } = await import('@/lib/db')

    const session = await getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }

    // Users can only fetch their own profile
    const userId = data as UserId
    if (session.user.id !== userId) {
      throw new Error("Access denied: Cannot view other users' profiles")
    }

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
  brandingConfig: z.record(z.string(), z.unknown()),
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
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { updateCustomCss } = await import('@/lib/settings/settings.service')

    await requireAuth({ roles: ['admin'] })

    return await updateCustomCss(data.customCss)
  })

/**
 * Update branding theme configuration
 */
export const updateThemeFn = createServerFn({ method: 'POST' })
  .inputValidator(updateThemeSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { updateBrandingConfig } = await import('@/lib/settings/settings.service')

    await requireAuth({ roles: ['admin'] })

    return await updateBrandingConfig(data.brandingConfig as BrandingConfig)
  })

/**
 * Update portal configuration (OAuth, features)
 */
export const updatePortalConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalConfigSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { updatePortalConfig } = await import('@/lib/settings/settings.service')

    await requireAuth({ roles: ['admin'] })

    return await updatePortalConfig(data as UpdatePortalConfigInput)
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
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { uploadLogo } = await import('@/lib/settings/settings.service')

    await requireAuth({ roles: ['admin'] })

    const blob = Buffer.from(data.base64, 'base64')
    return await uploadLogo({
      blob,
      mimeType: data.mimeType,
    })
  })

/**
 * Delete logo
 */
export const deleteLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { requireAuth } = await import('./auth-helpers')
  const { deleteLogo } = await import('@/lib/settings/settings.service')

  await requireAuth({ roles: ['admin'] })

  return await deleteLogo()
})

/**
 * Upload header logo (horizontal wordmark/lockup)
 */
export const uploadHeaderLogoFn = createServerFn({ method: 'POST' })
  .inputValidator(uploadHeaderLogoSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { uploadHeaderLogo } = await import('@/lib/settings/settings.service')

    await requireAuth({ roles: ['admin'] })

    const blob = Buffer.from(data.base64, 'base64')
    return await uploadHeaderLogo({
      blob,
      mimeType: data.mimeType,
    })
  })

/**
 * Delete header logo
 */
export const deleteHeaderLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { requireAuth } = await import('./auth-helpers')
  const { deleteHeaderLogo } = await import('@/lib/settings/settings.service')

  await requireAuth({ roles: ['admin'] })

  return await deleteHeaderLogo()
})

/**
 * Update header display mode
 */
export const updateHeaderDisplayModeFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayModeSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { updateHeaderDisplayMode } = await import('@/lib/settings/settings.service')

    await requireAuth({ roles: ['admin'] })

    return await updateHeaderDisplayMode(data.mode)
  })

/**
 * Update header display name
 */
export const updateHeaderDisplayNameFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayNameSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { updateHeaderDisplayName } = await import('@/lib/settings/settings.service')

    await requireAuth({ roles: ['admin'] })

    return await updateHeaderDisplayName(data.name)
  })
