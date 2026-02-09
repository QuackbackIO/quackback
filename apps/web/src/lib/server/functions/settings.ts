import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
// Import types from barrel export (client-safe)
import {
  DEFAULT_PORTAL_CONFIG,
  type BrandingConfig,
  type UpdatePortalConfigInput,
} from '@/lib/server/domains/settings'
import { userIdSchema, type UserId } from '@quackback/ids'
import {
  getBrandingConfig,
  getPortalConfig,
  getPublicPortalConfig,
  getPublicAuthConfig,
  updateBrandingConfig,
  updatePortalConfig,
  getDeveloperConfig,
  updateDeveloperConfig,
  saveLogoKey,
  deleteLogoKey,
  saveHeaderLogoKey,
  deleteHeaderLogoKey,
  updateHeaderDisplayMode,
  updateHeaderDisplayName,
  updateWorkspaceName,
  getCustomCss,
  updateCustomCss,
} from '@/lib/server/domains/settings/settings.service'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { requireAuth } from './auth-helpers'
import { getSession } from './auth'
import { db, principal, user, invitation, eq, ne } from '@/lib/server/db'

// ============================================
// Read Operations
// ============================================

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

export const fetchDeveloperConfig = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  return getDeveloperConfig()
})

function buildAvatarUrl(p: { avatarKey: string | null; avatarUrl: string | null }): string | null {
  if (p.avatarKey) {
    return getPublicUrlOrNull(p.avatarKey)
  }
  return p.avatarUrl
}

export const fetchTeamMembersAndInvitations = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAuth({ roles: ['admin', 'member'] })

    const members = await db
      .select({
        id: principal.id,
        role: principal.role,
        userId: principal.userId,
        avatarKey: principal.avatarKey,
        avatarUrl: principal.avatarUrl,
        userName: user.name,
        userEmail: user.email,
      })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .where(ne(principal.role, 'user'))

    const pendingInvitations = await db.query.invitation.findMany({
      where: eq(invitation.status, 'pending'),
      orderBy: (inv, { desc }) => [desc(inv.createdAt)],
    })

    // Build avatar map from principal fields (keyed by userId for the frontend)
    const avatarMap: Record<string, string | null> = {}

    for (const m of members) {
      if (m.userId) {
        avatarMap[m.userId] = buildAvatarUrl(m)
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
      columns: { imageKey: true, image: true },
    })

    const hasCustomAvatar = !!userRecord?.imageKey
    const oauthAvatarUrl = userRecord?.image ?? null
    const avatarUrl = buildAvatarUrl({
      avatarKey: userRecord?.imageKey ?? null,
      avatarUrl: oauthAvatarUrl,
    })

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
      email: z.boolean().optional(),
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

const saveLogoKeySchema = z.object({
  key: z.string(),
})

const updateHeaderDisplayModeSchema = z.object({
  mode: z.enum(['logo_and_name', 'logo_only', 'custom_logo']),
})

const updateHeaderDisplayNameSchema = z.object({
  name: z.string().nullable(),
})

export type UpdateThemeInput = z.infer<typeof updateThemeSchema>
export type UpdatePortalConfigActionInput = z.infer<typeof updatePortalConfigSchema>
export type SaveLogoKeyInput = z.infer<typeof saveLogoKeySchema>
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

export const saveLogoKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return saveLogoKey(data.key)
  })

export const deleteLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  return deleteLogoKey()
})

export const saveHeaderLogoKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return saveHeaderLogoKey(data.key)
  })

export const deleteHeaderLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  return deleteHeaderLogoKey()
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

// ============================================
// Custom CSS Operations
// ============================================

const MAX_CUSTOM_CSS_SIZE = 50 * 1024 // 50KB limit

const updateCustomCssSchema = z.object({
  customCss: z.string().max(MAX_CUSTOM_CSS_SIZE, 'Custom CSS exceeds 50KB limit'),
})

export type UpdateCustomCssInput = z.infer<typeof updateCustomCssSchema>

export const fetchCustomCssFn = createServerFn({ method: 'GET' }).handler(async () => {
  return getCustomCss()
})

export const updateCustomCssFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCustomCssSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return updateCustomCss(data.customCss)
  })

// ============================================
// Developer Config Operations
// ============================================

const updateDeveloperConfigSchema = z.object({
  mcpEnabled: z.boolean().optional(),
})

export const updateDeveloperConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(updateDeveloperConfigSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return updateDeveloperConfig(data)
  })
