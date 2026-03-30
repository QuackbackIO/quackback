import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
// Import types from barrel export (client-safe)
import {
  DEFAULT_PORTAL_CONFIG,
  type BrandingConfig,
  type UpdatePortalConfigInput,
} from '@/lib/server/domains/settings'
import { userIdSchema, type UserId } from '@featurepool/ids'
import {
  getPortalConfig,
  getPublicPortalConfig,
  getPublicAuthConfig,
  updatePortalConfig,
  getDeveloperConfig,
  updateDeveloperConfig,
} from '@/lib/server/domains/settings/settings.service'
import {
  getBrandingConfig,
  updateBrandingConfig,
  saveLogoKey,
  deleteLogoKey,
  saveHeaderLogoKey,
  deleteHeaderLogoKey,
  updateHeaderDisplayMode,
  updateHeaderDisplayName,
  updateWorkspaceName,
  getCustomCss,
  updateCustomCss,
} from '@/lib/server/domains/settings/settings.media'
import {
  getWidgetConfig,
  updateWidgetConfig,
  getWidgetSecret,
  regenerateWidgetSecret,
} from '@/lib/server/domains/settings/settings.widget'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { requireAuth } from './auth-helpers'
import { getSession } from './auth'
import { db, principal, user, invitation, eq, ne } from '@/lib/server/db'

// ============================================
// Read Operations
// ============================================

export const fetchBrandingConfig = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings] fetchBrandingConfig`)
  try {
    return await getBrandingConfig()
  } catch (error) {
    console.error(`[fn:settings] fetchBrandingConfig failed:`, error)
    throw error
  }
})

export const fetchPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings] fetchPortalConfig`)
  try {
    const config = await getPortalConfig()
    return config ?? DEFAULT_PORTAL_CONFIG
  } catch (error) {
    console.error(`[fn:settings] fetchPortalConfig failed:`, error)
    throw error
  }
})

export const fetchPublicPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings] fetchPublicPortalConfig`)
  try {
    return await getPublicPortalConfig()
  } catch (error) {
    console.error(`[fn:settings] fetchPublicPortalConfig failed:`, error)
    throw error
  }
})

export const fetchPublicAuthConfig = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings] fetchPublicAuthConfig`)
  try {
    return await getPublicAuthConfig()
  } catch (error) {
    console.error(`[fn:settings] fetchPublicAuthConfig failed:`, error)
    throw error
  }
})

export const fetchDeveloperConfig = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings] fetchDeveloperConfig`)
  try {
    await requireAuth({ roles: ['admin'] })
    return await getDeveloperConfig()
  } catch (error) {
    console.error(`[fn:settings] fetchDeveloperConfig failed:`, error)
    throw error
  }
})

function buildAvatarUrl(p: { avatarKey: string | null; avatarUrl: string | null }): string | null {
  if (p.avatarKey) {
    return getPublicUrlOrNull(p.avatarKey)
  }
  return p.avatarUrl
}

export const fetchTeamMembersAndInvitations = createServerFn({ method: 'GET' }).handler(
  async () => {
    console.log(`[fn:settings] fetchTeamMembersAndInvitations`)
    try {
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
    } catch (error) {
      console.error(`[fn:settings] fetchTeamMembersAndInvitations failed:`, error)
      throw error
    }
  }
)

export const fetchUserProfile = createServerFn({ method: 'GET' })
  .inputValidator(userIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:settings] fetchUserProfile: userId=${data}`)
    try {
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
    } catch (error) {
      console.error(`[fn:settings] fetchUserProfile failed:`, error)
      throw error
    }
  })

// ============================================
// Write Operations
// ============================================

const updateThemeSchema = z.object({
  brandingConfig: z.record(z.string(), z.unknown()),
})

const updatePortalConfigSchema = z.object({
  oauth: z.record(z.string(), z.boolean().optional()).optional(),
  features: z
    .object({
      publicView: z.boolean().optional(),
      submissions: z.boolean().optional(),
      comments: z.boolean().optional(),
      voting: z.boolean().optional(),
      anonymousVoting: z.boolean().optional(),
      anonymousCommenting: z.boolean().optional(),
      anonymousPosting: z.boolean().optional(),
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
    console.log(`[fn:settings] updateThemeFn`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await updateBrandingConfig(data.brandingConfig as BrandingConfig)
    } catch (error) {
      console.error(`[fn:settings] updateThemeFn failed:`, error)
      throw error
    }
  })

export const updatePortalConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalConfigSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:settings] updatePortalConfigFn`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await updatePortalConfig(data as UpdatePortalConfigInput)
    } catch (error) {
      console.error(`[fn:settings] updatePortalConfigFn failed:`, error)
      throw error
    }
  })

export const saveLogoKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    console.log(`[fn:settings] saveLogoKeyFn: key=${data.key}`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await saveLogoKey(data.key)
    } catch (error) {
      console.error(`[fn:settings] saveLogoKeyFn failed:`, error)
      throw error
    }
  })

export const deleteLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  console.log(`[fn:settings] deleteLogoFn`)
  try {
    await requireAuth({ roles: ['admin'] })
    return await deleteLogoKey()
  } catch (error) {
    console.error(`[fn:settings] deleteLogoFn failed:`, error)
    throw error
  }
})

export const saveHeaderLogoKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    console.log(`[fn:settings] saveHeaderLogoKeyFn: key=${data.key}`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await saveHeaderLogoKey(data.key)
    } catch (error) {
      console.error(`[fn:settings] saveHeaderLogoKeyFn failed:`, error)
      throw error
    }
  })

export const deleteHeaderLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  console.log(`[fn:settings] deleteHeaderLogoFn`)
  try {
    await requireAuth({ roles: ['admin'] })
    return await deleteHeaderLogoKey()
  } catch (error) {
    console.error(`[fn:settings] deleteHeaderLogoFn failed:`, error)
    throw error
  }
})

export const updateHeaderDisplayModeFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayModeSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:settings] updateHeaderDisplayModeFn: mode=${data.mode}`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await updateHeaderDisplayMode(data.mode)
    } catch (error) {
      console.error(`[fn:settings] updateHeaderDisplayModeFn failed:`, error)
      throw error
    }
  })

export const updateHeaderDisplayNameFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHeaderDisplayNameSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:settings] updateHeaderDisplayNameFn: name=${data.name}`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await updateHeaderDisplayName(data.name)
    } catch (error) {
      console.error(`[fn:settings] updateHeaderDisplayNameFn failed:`, error)
      throw error
    }
  })

const updateWorkspaceNameSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
})

export type UpdateWorkspaceNameInput = z.infer<typeof updateWorkspaceNameSchema>

export const updateWorkspaceNameFn = createServerFn({ method: 'POST' })
  .inputValidator(updateWorkspaceNameSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:settings] updateWorkspaceNameFn: name=${data.name}`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await updateWorkspaceName(data.name)
    } catch (error) {
      console.error(`[fn:settings] updateWorkspaceNameFn failed:`, error)
      throw error
    }
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
  console.log(`[fn:settings] fetchCustomCssFn`)
  try {
    return await getCustomCss()
  } catch (error) {
    console.error(`[fn:settings] fetchCustomCssFn failed:`, error)
    throw error
  }
})

export const updateCustomCssFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCustomCssSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:settings] updateCustomCssFn: cssLength=${data.customCss.length}`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await updateCustomCss(data.customCss)
    } catch (error) {
      console.error(`[fn:settings] updateCustomCssFn failed:`, error)
      throw error
    }
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
    console.log(`[fn:settings] updateDeveloperConfigFn: mcpEnabled=${data.mcpEnabled}`)
    try {
      await requireAuth({ roles: ['admin'] })
      return await updateDeveloperConfig(data)
    } catch (error) {
      console.error(`[fn:settings] updateDeveloperConfigFn failed:`, error)
      throw error
    }
  })

// ============================================
// Widget Config Operations
// ============================================

export const fetchWidgetConfig = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings] fetchWidgetConfig`)
  try {
    await requireAuth({ roles: ['admin'] })
    return await getWidgetConfig()
  } catch (error) {
    console.error(`[fn:settings] fetchWidgetConfig failed:`, error)
    throw error
  }
})

export const fetchWidgetSecret = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings] fetchWidgetSecret`)
  try {
    await requireAuth({ roles: ['admin'] })
    return await getWidgetSecret()
  } catch (error) {
    console.error(`[fn:settings] fetchWidgetSecret failed:`, error)
    throw error
  }
})

const updateWidgetConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaultBoard: z.string().optional(),
  position: z.enum(['bottom-right', 'bottom-left']).optional(),
  identifyVerification: z.boolean().optional(),
  tabs: z
    .object({
      feedback: z.boolean().optional(),
      changelog: z.boolean().optional(),
    })
    .optional(),
})

export const updateWidgetConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(updateWidgetConfigSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:settings] updateWidgetConfigFn: enabled=${data.enabled}, position=${data.position}`
    )
    try {
      await requireAuth({ roles: ['admin'] })
      return await updateWidgetConfig(data)
    } catch (error) {
      console.error(`[fn:settings] updateWidgetConfigFn failed:`, error)
      throw error
    }
  })

export const regenerateWidgetSecretFn = createServerFn({ method: 'POST' }).handler(async () => {
  console.log(`[fn:settings] regenerateWidgetSecretFn`)
  try {
    await requireAuth({ roles: ['admin'] })
    return await regenerateWidgetSecret()
  } catch (error) {
    console.error(`[fn:settings] regenerateWidgetSecretFn failed:`, error)
    throw error
  }
})
