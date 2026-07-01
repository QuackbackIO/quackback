import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { tiptapContentSchema } from '@/lib/shared/schemas/posts'
// Import types from barrel export (client-safe)
import {
  DEFAULT_PORTAL_CONFIG,
  type BrandingConfig,
  type UpdatePortalConfigInput,
} from '@/lib/server/domains/settings'
import { userIdSchema, type UserId } from '@quackback/ids'
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
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { actorFromAuth, recordAuditEvent, type AuditEventType } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'
import { getSession } from '@/lib/server/auth/session'
import { db, principal, user, invitation, account, eq, ne, and } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'settings' })

// ============================================
// Read Operations
// ============================================

export const fetchBrandingConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch branding config')
  try {
    return await getBrandingConfig()
  } catch (error) {
    log.error({ err: error }, 'fetch branding config failed')
    throw error
  }
})

export const fetchPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch portal config')
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const config = await getPortalConfig()
    return config ?? DEFAULT_PORTAL_CONFIG
  } catch (error) {
    log.error({ err: error }, 'fetch portal config failed')
    throw error
  }
})

export const fetchPublicPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch public portal config')
  try {
    return await getPublicPortalConfig()
  } catch (error) {
    log.error({ err: error }, 'fetch public portal config failed')
    throw error
  }
})

export const fetchPublicAuthConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch public auth config')
  try {
    return await getPublicAuthConfig()
  } catch (error) {
    log.error({ err: error }, 'fetch public auth config failed')
    throw error
  }
})

/**
 * Full team-side auth config including ssoOidc. Admin-only — surfaces
 * to the admin auth settings page editor. clientSecret is never in
 * authConfig (it lives on the env), so this is safe to ship to the
 * admin form even though it's broader than `fetchPublicAuthConfig`.
 */
export const fetchAuthConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch auth config')
  try {
    await requireAuth({ permission: PERMISSIONS.AUTH_MANAGE })
    const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
    const tenant = await getTenantSettings()
    return (
      tenant?.authConfig ?? {
        oauth: { google: true, github: true, password: false },
        openSignup: false,
      }
    )
  } catch (error) {
    log.error({ err: error }, 'fetch auth config failed')
    throw error
  }
})

export const fetchDeveloperConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch developer config')
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return await getDeveloperConfig()
  } catch (error) {
    log.error({ err: error }, 'fetch developer config failed')
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
    log.debug('fetch team members and invitations')
    try {
      await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })

      // Subquery: latest session timestamp per user. Left-joined so
      // a team member with no sessions still appears (lastSignInAt
      // = null) — useful for spotting stale accounts.
      const { session, max, sql: sqlOp } = await import('@/lib/server/db')
      const lastSession = db
        .select({
          userId: session.userId,
          lastSignInAt: max(session.createdAt).as('last_sign_in_at'),
        })
        .from(session)
        .groupBy(session.userId)
        .as('last_session')

      const membersRaw = await db
        .select({
          id: principal.id,
          role: principal.role,
          userId: principal.userId,
          avatarKey: principal.avatarKey,
          avatarUrl: principal.avatarUrl,
          userName: user.name,
          userEmail: user.email,
          lastSignInAt: sqlOp<Date | null>`${lastSession.lastSignInAt}`,
        })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .leftJoin(lastSession, eq(lastSession.userId, user.id))
        .where(ne(principal.role, 'user'))

      // Serialise to ISO string on the boundary so the client type
      // stays narrow (`string | null`). `toIsoStringOrNull` handles
      // both the Date and string shapes — postgres-js returns the
      // `max()` aggregate as a string, plain timestamp selects come
      // back as Date.
      const { toIsoStringOrNull } = await import('@/lib/shared/utils/date')
      const members = membersRaw.map((m) => ({
        ...m,
        lastSignInAt: toIsoStringOrNull(m.lastSignInAt),
      }))

      const pendingInvitations = await db.query.invitation.findMany({
        where: and(eq(invitation.status, 'pending'), eq(invitation.kind, 'team')),
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
      log.error({ err: error }, 'fetch team members and invitations failed')
      throw error
    }
  }
)

export const fetchUserProfile = createServerFn({ method: 'GET' })
  .validator(userIdSchema)
  .handler(async ({ data }) => {
    log.debug({ user_id: data }, 'fetch user profile')
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      const userId = data as UserId
      if (session.user.id !== userId) {
        throw new Error("Access denied: Cannot view other users' profiles")
      }

      // Profile-page sections (Password, 2FA) depend on the user's auth
      // posture: do they actually use a password? Is their email
      // SSO-bound (so password and 2FA are both managed by the IdP)?
      // Resolve once server-side so the page doesn't fan out to
      // listAccounts on the client + so we can hide sections that aren't
      // meaningful for this user.
      const [userRecord, credentialAccount] = await Promise.all([
        db.query.user.findFirst({
          where: eq(user.id, userId),
          columns: { imageKey: true, image: true, twoFactorEnabled: true, email: true },
        }),
        db.query.account.findFirst({
          where: and(eq(account.userId, userId), eq(account.providerId, 'credential')),
          columns: { id: true },
        }),
      ])

      const { isHardBound } = await import('@/lib/server/auth/auth-restrictions')
      const { listIdentityProviders } =
        await import('@/lib/server/domains/settings/identity-providers.service')
      const { getRegisteredOidcProviderIds } =
        await import('@/lib/server/auth/registered-providers')
      const providers = await listIdentityProviders()
      const registeredOidcIds = await getRegisteredOidcProviderIds(providers)
      // Use the full predicate so the profile page hides the password
      // section for users whose email is at an enforced verified domain.
      // When the owning IdP isn't viable (tier downgrade, missing secret)
      // the predicate fails open — the UI then surfaces the password section
      // as a fallback, mirroring the sign-in flow.
      const ssoEnforced = isHardBound(
        'credential',
        userRecord?.email ?? null,
        providers,
        registeredOidcIds
      )

      const hasCustomAvatar = !!userRecord?.imageKey
      const oauthAvatarUrl = userRecord?.image ?? null
      const avatarUrl = buildAvatarUrl({
        avatarKey: userRecord?.imageKey ?? null,
        avatarUrl: oauthAvatarUrl,
      })

      return {
        avatarUrl,
        oauthAvatarUrl,
        hasCustomAvatar,
        twoFactorEnabled: userRecord?.twoFactorEnabled === true,
        hasPassword: !!credentialAccount,
        ssoEnforced,
      }
    } catch (error) {
      log.error({ err: error }, 'fetch user profile failed')
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
  features: z
    .object({
      allowAnonymous: z.boolean().optional(),
    })
    .optional(),
  welcomeCard: z
    .object({
      enabled: z.boolean().optional(),
      title: z.string().optional(),
      // Body is re-sanitized server-side by normalizeWelcomeCardInput;
      // tiptapContentSchema gates the shape at the boundary.
      body: tiptapContentSchema.optional(),
    })
    .optional(),
  support: z
    .object({
      enabled: z.boolean().optional(),
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
  .validator(updateThemeSchema)
  .handler(async ({ data }) => {
    log.info('update theme')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
      return await updateBrandingConfig(data.brandingConfig as BrandingConfig)
    } catch (error) {
      log.error({ err: error }, 'update theme failed')
      throw error
    }
  })

export const updatePortalConfigFn = createServerFn({ method: 'POST' })
  .validator(updatePortalConfigSchema)
  .handler(async ({ data }) => {
    log.info('update portal config')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
      return await updatePortalConfig(data as UpdatePortalConfigInput)
    } catch (error) {
      log.error({ err: error }, 'update portal config failed')
      throw error
    }
  })

export const updateAuthConfigSchema = z.object({
  oauth: z.record(z.string(), z.boolean().optional()).optional(),
  openSignup: z.boolean().optional(),
  ssoOidc: z
    .object({
      enabled: z.boolean().optional(),
      discoveryUrl: z.string().url().optional(),
      clientId: z.string().min(1).optional(),
      autoCreateUsers: z.boolean().optional(),
      autoProvisionRole: z.enum(['admin', 'member', 'user']).optional(),
      // Server-owned timestamps. `updateAuthConfig` stamps
      // `detailsChangedAt` itself when discoveryUrl/clientId change and
      // the SSO test callback stamps `lastSuccessfulTestAt`. They stay
      // in the schema (rather than `.strict()` rejecting them) so reads
      // that round-trip the whole config back through updateAuthConfig
      // — the config-file reconciler, the admin UI's draft save — don't
      // strip the values. UI callers never set them directly.
      detailsChangedAt: z.string().optional(),
      lastSuccessfulTestAt: z.string().optional(),
      attributeMapping: z
        .object({
          claimPath: z.string().min(1),
          rules: z.array(
            z.object({
              whenContains: z.string().min(1),
              role: z.enum(['admin', 'member', 'user']),
            })
          ),
          defaultRole: z.enum(['admin', 'member', 'user']),
          syncOnEverySignIn: z.boolean().optional(),
        })
        .optional(),
      // Per-domain SSO enforcement is server-owned via
      // setVerifiedDomainEnforcedFn (writes sso_verified_domain.enforced).
      // The legacy workspace-wide `ssoOidc.enforced` and `ssoOidc.domain`
      // keys are no longer part of the auth-config shape.
    })
    .strict()
    .optional(),
  twoFactor: z
    .object({
      required: z.boolean().optional(),
    })
    .strict()
    .optional(),
})

export type UpdateAuthConfigActionInput = z.infer<typeof updateAuthConfigSchema>

/**
 * OAuth toggles that get their own audit event when flipped. Other
 * provider toggles (google, github, etc.) are routine OAuth IdP
 * changes — useful but not security-critical enough to warrant a
 * named event-type slot. Password and magic-link are different
 * because flipping either one changes the workspace's break-glass
 * surface.
 */
const AUDIT_TRACKED_OAUTH_KEYS: Array<{
  key: 'password' | 'magicLink'
  enabled: AuditEventType
  disabled: AuditEventType
}> = [
  { key: 'password', enabled: 'auth.password.enabled', disabled: 'auth.password.disabled' },
  {
    key: 'magicLink',
    enabled: 'auth.magic_link.enabled',
    disabled: 'auth.magic_link.disabled',
  },
]

export const updateAuthConfigFn = createServerFn({ method: 'POST' })
  .validator(updateAuthConfigSchema)
  .handler(async ({ data }) => {
    log.info('update auth config')
    try {
      const { getRequestHeaders } = await import('@tanstack/react-start/server')
      const auth = await requireAuth({ permission: PERMISSIONS.AUTH_MANAGE })
      const actor = actorFromAuth(auth)
      const headers = getRequestHeaders()

      const { updateAuthConfig, getAuthConfig } =
        await import('@/lib/server/domains/settings/settings.service')

      // Snapshot when the payload touches an audit-tracked key OR the
      // ssoOidc subtree. Both audits compare prior/new state to decide
      // whether to emit. Routine non-tracked saves skip the read.
      const tracksAnyToggle = Boolean(
        data.oauth && AUDIT_TRACKED_OAUTH_KEYS.some(({ key }) => key in (data.oauth ?? {}))
      )
      const tracksSso = Boolean(data.ssoOidc)
      const before = tracksAnyToggle || tracksSso ? await getAuthConfig() : null

      try {
        // Backstop the unified "keep ≥1 working sign-in method" invariant — a
        // direct API call must not be able to disable the workspace's last way
        // in (the client `isLastMethod` guard covers only the UI). A blocked
        // attempt falls through to the failure audit + re-throw below.
        if (data.oauth) {
          const current = before ?? (await getAuthConfig())
          const proposedOauth = {
            ...((current?.oauth ?? {}) as Record<string, boolean | undefined>),
            ...data.oauth,
          }
          const { wouldLeaveNoWorkingSignInMethod } =
            await import('@/lib/server/auth/sign-in-method-availability')
          if (await wouldLeaveNoWorkingSignInMethod(proposedOauth)) {
            const { ConflictError } = await import('@/lib/shared/errors')
            throw new ConflictError(
              'LAST_SIGN_IN_METHOD',
              'Cannot disable the last enabled sign-in method. Enable another method first.'
            )
          }
        }

        const result = await updateAuthConfig(data as Parameters<typeof updateAuthConfig>[0])

        if (tracksAnyToggle && before && data.oauth) {
          for (const { key, enabled, disabled } of AUDIT_TRACKED_OAUTH_KEYS) {
            if (!(key in data.oauth)) continue
            const next = data.oauth[key]
            const prior = (before.oauth as Record<string, boolean | undefined>)?.[key]
            if (typeof next !== 'boolean' || next === prior) continue
            await recordAuditEvent({
              event: next ? enabled : disabled,
              outcome: 'success',
              actor,
              headers,
              before: { [key]: prior ?? null },
              after: { [key]: next },
            })
          }
        }

        if (tracksSso && before && data.ssoOidc) {
          const priorSso = (before.ssoOidc ?? {}) as Record<string, unknown>
          const changedFields: string[] = []
          for (const key of Object.keys(data.ssoOidc)) {
            if (priorSso[key] !== (data.ssoOidc as Record<string, unknown>)[key]) {
              changedFields.push(key)
            }
          }
          if (changedFields.length > 0) {
            await recordAuditEvent({
              event: 'sso.config.changed',
              outcome: 'success',
              actor,
              headers,
              metadata: { fields: changedFields },
            })
          }
        }

        return result
      } catch (error) {
        // Symmetric failure audit so blocked attempts (tier gate,
        // managed-fields, secret-presence) show up in the log.
        if (tracksAnyToggle && data.oauth) {
          for (const { key, enabled, disabled } of AUDIT_TRACKED_OAUTH_KEYS) {
            if (!(key in data.oauth)) continue
            const next = data.oauth[key]
            if (typeof next !== 'boolean') continue
            await recordAuditEvent({
              event: next ? enabled : disabled,
              outcome: 'failure',
              actor,
              headers,
              metadata: {
                reason: error instanceof Error ? error.message.slice(0, 200) : 'UNEXPECTED',
              },
            })
          }
        }
        if (tracksSso) {
          await recordAuditEvent({
            event: 'sso.config.changed',
            outcome: 'failure',
            actor,
            headers,
            metadata: {
              fields: Object.keys(data.ssoOidc ?? {}),
              reason: error instanceof Error ? error.message.slice(0, 200) : 'UNEXPECTED',
            },
          })
        }
        throw error
      }
    } catch (error) {
      log.error({ err: error }, 'update auth config failed')
      throw error
    }
  })

export const saveLogoKeyFn = createServerFn({ method: 'POST' })
  .validator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    log.info({ key: data.key }, 'save logo key')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
      return await saveLogoKey(data.key)
    } catch (error) {
      log.error({ err: error }, 'save logo key failed')
      throw error
    }
  })

export const deleteLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('delete logo')
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await deleteLogoKey()
  } catch (error) {
    log.error({ err: error }, 'delete logo failed')
    throw error
  }
})

export const saveHeaderLogoKeyFn = createServerFn({ method: 'POST' })
  .validator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    log.info({ key: data.key }, 'save header logo key')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
      return await saveHeaderLogoKey(data.key)
    } catch (error) {
      log.error({ err: error }, 'save header logo key failed')
      throw error
    }
  })

export const deleteHeaderLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('delete header logo')
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await deleteHeaderLogoKey()
  } catch (error) {
    log.error({ err: error }, 'delete header logo failed')
    throw error
  }
})

export const updateHeaderDisplayModeFn = createServerFn({ method: 'POST' })
  .validator(updateHeaderDisplayModeSchema)
  .handler(async ({ data }) => {
    log.info({ mode: data.mode }, 'update header display mode')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
      return await updateHeaderDisplayMode(data.mode)
    } catch (error) {
      log.error({ err: error }, 'update header display mode failed')
      throw error
    }
  })

export const updateHeaderDisplayNameFn = createServerFn({ method: 'POST' })
  .validator(updateHeaderDisplayNameSchema)
  .handler(async ({ data }) => {
    log.info({ name: data.name }, 'update header display name')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
      return await updateHeaderDisplayName(data.name)
    } catch (error) {
      log.error({ err: error }, 'update header display name failed')
      throw error
    }
  })

const updateWorkspaceNameSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
})

export type UpdateWorkspaceNameInput = z.infer<typeof updateWorkspaceNameSchema>

export const updateWorkspaceNameFn = createServerFn({ method: 'POST' })
  .validator(updateWorkspaceNameSchema)
  .handler(async ({ data }) => {
    log.info({ name: data.name }, 'update workspace name')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
      return await updateWorkspaceName(data.name)
    } catch (error) {
      log.error({ err: error }, 'update workspace name failed')
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
  log.debug('fetch custom css')
  try {
    return await getCustomCss()
  } catch (error) {
    log.error({ err: error }, 'fetch custom css failed')
    throw error
  }
})

export const updateCustomCssFn = createServerFn({ method: 'POST' })
  .validator(updateCustomCssSchema)
  .handler(async ({ data }) => {
    log.info({ css_length: data.customCss.length }, 'update custom css')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
      return await updateCustomCss(data.customCss)
    } catch (error) {
      log.error({ err: error }, 'update custom css failed')
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
  .validator(updateDeveloperConfigSchema)
  .handler(async ({ data }) => {
    log.info({ mcp_enabled: data.mcpEnabled }, 'update developer config')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
      return await updateDeveloperConfig(data)
    } catch (error) {
      log.error({ err: error }, 'update developer config failed')
      throw error
    }
  })

// ============================================
// Widget Config Operations
// ============================================

export const fetchWidgetConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch widget config')
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { getWidgetConfig } = await import('@/lib/server/domains/settings/settings.widget')
    return await getWidgetConfig()
  } catch (error) {
    log.error({ err: error }, 'fetch widget config failed')
    throw error
  }
})

export const fetchWidgetSecret = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch widget secret')
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { getWidgetSecret } = await import('@/lib/server/domains/settings/settings.widget')
    return await getWidgetSecret()
  } catch (error) {
    log.error({ err: error }, 'fetch widget secret failed')
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
      help: z.boolean().optional(),
      chat: z.boolean().optional(),
      home: z.boolean().optional(),
    })
    .optional(),
  chat: z
    .object({
      enabled: z.boolean().optional(),
      welcomeMessage: z.string().max(500).optional(),
      offlineMessage: z.string().max(500).optional(),
      teamName: z.string().max(80).optional(),
      preChatEmail: z.enum(['off', 'optional', 'required']).optional(),
      officeHours: z
        .object({
          enabled: z.boolean(),
          timezone: z.string().max(64),
          days: z
            .array(
              z.object({
                enabled: z.boolean(),
                start: z.string().regex(/^\d{2}:\d{2}$/),
                end: z.string().regex(/^\d{2}:\d{2}$/),
              })
            )
            .length(7),
        })
        .optional(),
      cannedReplies: z
        .array(
          z.object({
            id: z.string().max(64),
            title: z.string().max(80),
            body: z.string().max(2000),
          })
        )
        .max(100)
        .optional(),
      routing: z
        .object({
          enabled: z.boolean(),
          strategy: z.literal('auto_assign_active'),
        })
        .optional(),
    })
    .optional(),
})

export const updateWidgetConfigFn = createServerFn({ method: 'POST' })
  .validator(updateWidgetConfigSchema)
  .handler(async ({ data }) => {
    log.info({ enabled: data.enabled, position: data.position }, 'update widget config')
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
      const { updateWidgetConfig } = await import('@/lib/server/domains/settings/settings.widget')
      return await updateWidgetConfig(data)
    } catch (error) {
      log.error({ err: error }, 'update widget config failed')
      throw error
    }
  })

export const regenerateWidgetSecretFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('regenerate widget secret')
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { regenerateWidgetSecret } = await import('@/lib/server/domains/settings/settings.widget')
    return await regenerateWidgetSecret()
  } catch (error) {
    log.error({ err: error }, 'regenerate widget secret failed')
    throw error
  }
})

// ============================================
// Moderation Default Operations
// ============================================

const moderationDefaultSchema = z.object({
  requireApproval: z.enum(['none', 'anonymous', 'authenticated', 'all']),
})

/**
 * Read-only status of the conversation email channel (admin-only). Reports
 * which outbound provider the environment resolves to, the from-address, and
 * whether inbound reply threading is configured — names only, never secrets.
 */
export const getEmailChannelStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('get email channel status')
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { getEmailProvider } = await import('@quackback/email')
    const { isEmailInboundConfigured } =
      await import('@/lib/server/domains/chat/chat.email-channel')
    return {
      provider: getEmailProvider(),
      fromAddress: process.env.EMAIL_FROM ?? null,
      inboundConfigured: isEmailInboundConfigured(),
      inboundDomain: process.env.EMAIL_INBOUND_DOMAIN ?? null,
    }
  } catch (error) {
    log.error({ err: error }, 'get email channel status failed')
    throw error
  }
})

export const updateModerationDefaultFn = createServerFn({ method: 'POST' })
  .validator(moderationDefaultSchema.parse)
  .handler(async ({ data }) => {
    log.info({ require_approval: data.requireApproval }, 'update moderation default')
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MODERATION })
    const before = await getPortalConfig()
    const updated = await updatePortalConfig({ moderationDefault: data })
    await recordAuditEvent({
      event: 'moderation.default.changed',
      actor: actorFromAuth(auth),
      target: { type: 'settings', id: 'portal-config' },
      before: { moderationDefault: before.moderationDefault },
      after: { moderationDefault: updated.moderationDefault },
    })
    return { moderationDefault: updated.moderationDefault }
  })
