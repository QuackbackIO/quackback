import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
// Import types from barrel export (client-safe)
import {
  DEFAULT_PORTAL_CONFIG,
  type BrandingConfig,
  type UpdatePortalConfigInput,
} from '@/lib/settings'
import { userIdSchema, type UserId } from '@quackback/ids'
import { getWorkspaceFeatures } from '@/lib/features/server'
import {
  getBrandingConfig,
  getPortalConfig,
  getPublicPortalConfig,
  getPublicAuthConfig,
  updateBrandingConfig,
  updatePortalConfig,
  uploadLogo,
  deleteLogo,
  uploadHeaderLogo,
  deleteHeaderLogo,
  updateHeaderDisplayMode,
  updateHeaderDisplayName,
  updateWorkspaceName,
} from '@/lib/settings/settings.service'
import { requireAuth } from './auth-helpers'
import { getSession } from './auth'
import { db, member, user, invitation, eq, ne } from '@/lib/db'

// ============================================
// Read Operations
// ============================================

export const getWorkspaceFeaturesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const features = await getWorkspaceFeatures()
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

export const fetchBrandingConfig = createServerFn({ method: 'GET' }).handler(async () => {
  return getBrandingConfig()
})

export const fetchPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const config = await getPortalConfig()
  return config ?? DEFAULT_PORTAL_CONFIG
})

export const fetchPublicPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  return getPublicPortalConfig()
})

export const fetchPublicAuthConfig = createServerFn({ method: 'GET' }).handler(async () => {
  return getPublicAuthConfig()
})

function buildAvatarUrl(
  imageBlob: Buffer | null,
  imageType: string | null,
  fallbackUrl: string | null
): string | null {
  if (imageBlob && imageType) {
    return `data:${imageType};base64,${Buffer.from(imageBlob).toString('base64')}`
  }
  return fallbackUrl
}

export const fetchTeamMembersAndInvitations = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAuth({ roles: ['admin', 'member'] })

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

    const pendingInvitations = await db.query.invitation.findMany({
      where: eq(invitation.status, 'pending'),
      orderBy: (inv, { desc }) => [desc(inv.createdAt)],
    })

    const userIds = members.map((m) => m.userId)
    const avatarMap: Record<string, string | null> = {}

    if (userIds.length > 0) {
      const users = await db.query.user.findMany({
        where: (u, { inArray }) => inArray(u.id, userIds),
        columns: { id: true, imageBlob: true, imageType: true, image: true },
      })

      for (const u of users) {
        avatarMap[u.id] = buildAvatarUrl(u.imageBlob, u.imageType, u.image)
      }
      for (const userId of userIds) {
        if (!(userId in avatarMap)) {
          avatarMap[userId] = null
        }
      }
    }

    const formattedInvitations = pendingInvitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      name: inv.name,
      role: inv.role,
      createdAt: inv.createdAt.toISOString(),
      lastSentAt: inv.lastSentAt?.toISOString() ?? null,
      expiresAt: inv.expiresAt.toISOString(),
    }))

    return { members, avatarMap, formattedInvitations }
  }
)

export const fetchUserProfile = createServerFn({ method: 'GET' })
  .inputValidator(userIdSchema)
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }

    const userId = data as UserId
    if (session.user.id !== userId) {
      throw new Error("Access denied: Cannot view other users' profiles")
    }

    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, userId),
      columns: { imageBlob: true, imageType: true, image: true },
    })

    const hasCustomAvatar = !!(userRecord?.imageBlob && userRecord?.imageType)
    const oauthAvatarUrl = userRecord?.image ?? null
    const avatarUrl = buildAvatarUrl(
      userRecord?.imageBlob ?? null,
      userRecord?.imageType ?? null,
      oauthAvatarUrl
    )

    return { avatarUrl, oauthAvatarUrl, hasCustomAvatar }
  })

// ============================================
// Write Operations
// ============================================

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

const uploadLogoSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
})

const updateHeaderDisplayModeSchema = z.object({
  mode: z.enum(['logo_and_name', 'logo_only', 'custom_logo']),
})

const updateHeaderDisplayNameSchema = z.object({
  name: z.string().nullable(),
})

export type UpdateThemeInput = z.infer<typeof updateThemeSchema>
export type UpdatePortalConfigActionInput = z.infer<typeof updatePortalConfigSchema>
export type UploadLogoInput = z.infer<typeof uploadLogoSchema>
export type UpdateHeaderDisplayModeInput = z.infer<typeof updateHeaderDisplayModeSchema>
export type UpdateHeaderDisplayNameInput = z.infer<typeof updateHeaderDisplayNameSchema>

export const updateThemeFn = createServerFn({ method: 'POST' })
  .inputValidator(updateThemeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return updateBrandingConfig(data.brandingConfig as BrandingConfig)
  })

export const updatePortalConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalConfigSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return updatePortalConfig(data as UpdatePortalConfigInput)
  })

export const uploadLogoFn = createServerFn({ method: 'POST' })
  .inputValidator(uploadLogoSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return uploadLogo({ blob: Buffer.from(data.base64, 'base64'), mimeType: data.mimeType })
  })

export const deleteLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  return deleteLogo()
})

export const uploadHeaderLogoFn = createServerFn({ method: 'POST' })
  .inputValidator(uploadLogoSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return uploadHeaderLogo({ blob: Buffer.from(data.base64, 'base64'), mimeType: data.mimeType })
  })

export const deleteHeaderLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  return deleteHeaderLogo()
})

export const updateHeaderDisplayModeFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayModeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return updateHeaderDisplayMode(data.mode)
  })

export const updateHeaderDisplayNameFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayNameSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return updateHeaderDisplayName(data.name)
  })

const updateWorkspaceNameSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
})

export type UpdateWorkspaceNameInput = z.infer<typeof updateWorkspaceNameSchema>

export const updateWorkspaceNameFn = createServerFn({ method: 'POST' })
  .inputValidator(updateWorkspaceNameSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return updateWorkspaceName(data.name)
  })
