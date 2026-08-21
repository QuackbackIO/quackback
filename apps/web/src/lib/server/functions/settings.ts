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
  savePortalOgImageKey,
  deletePortalOgImageKey,
  saveFaviconKey,
  deleteFaviconKey,
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
import { officeHoursScheduleSchema } from '@/lib/server/domains/settings/settings.office-hours'
import { changelogSettingsSchema } from '@/lib/shared/changelog-settings'
import { workflowAbandonedAutoCloseSchema } from '@/lib/shared/workflows/abandoned-auto-close'
import { workflowCloseSpamSchema } from '@/lib/shared/workflows/close-spam'
import { defaultSlaPolicySchema } from '@/lib/shared/sla/default-policy'
import { MAX_TRUSTED_SENDERS } from '@/lib/shared/trusted-senders'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'settings' })

// ============================================
// Read Operations
// ============================================

export const fetchBrandingConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch branding config')
  return await getBrandingConfig()
})

export const fetchPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch portal config')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const config = await getPortalConfig()
  return config ?? DEFAULT_PORTAL_CONFIG
})

export const fetchPublicPortalConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch public portal config')
  return await getPublicPortalConfig()
})

export const fetchPublicAuthConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch public auth config')
  return await getPublicAuthConfig()
})

/**
 * Full team-side auth config including ssoOidc. Admin-only — surfaces
 * to the admin auth settings page editor. clientSecret is never in
 * authConfig (it lives on the env), so this is safe to ship to the
 * admin form even though it's broader than `fetchPublicAuthConfig`.
 */
export const fetchAuthConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch auth config')
  await requireAuth({ permission: PERMISSIONS.AUTH_MANAGE })
  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const workspace = await getWorkspaceSettings()
  // The shipped defaults, not a second set written out here. A form that showed
  // `openSignup: false` while the server behaved as open is the disagreement
  // that made this setting worth enforcing in the first place — see
  // `DEFAULT_AUTH_CONFIG`. Only `password` differs, and deliberately: the admin
  // form starts with team password sign-in unticked.
  const { DEFAULT_AUTH_CONFIG } = await import('@/lib/server/domains/settings/settings.types')
  return (
    workspace?.authConfig ?? {
      ...DEFAULT_AUTH_CONFIG,
      oauth: { google: true, github: true, password: false },
    }
  )
})

export const fetchDeveloperConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch developer config')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  return await getDeveloperConfig()
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
    // Resolved workspace assignment (one per member post-reconcile) so the
    // table can show the real role name — a custom role, or a preset that
    // differs from the legacy column's implied one. Fetched separately to
    // avoid fanning out the member rows on a join.
    const { principalRoleAssignments, roles, isNull, inArray } = await import('@/lib/server/db')
    const memberIds = membersRaw.map((m) => m.id)
    const assignmentRows = memberIds.length
      ? await db
          .select({
            principalId: principalRoleAssignments.principalId,
            roleId: roles.id,
            roleKey: roles.key,
            roleName: roles.name,
            isSystem: roles.isSystem,
          })
          .from(principalRoleAssignments)
          .innerJoin(roles, eq(roles.id, principalRoleAssignments.roleId))
          .where(
            and(
              inArray(principalRoleAssignments.principalId, memberIds),
              isNull(principalRoleAssignments.teamId)
            )
          )
      : []
    const assignmentByPrincipal = new Map(assignmentRows.map((a) => [a.principalId, a]))

    const members = membersRaw.map((m) => {
      const assigned = assignmentByPrincipal.get(m.id)
      return {
        ...m,
        lastSignInAt: toIsoStringOrNull(m.lastSignInAt),
        assignedRole: assigned
          ? {
              id: assigned.roleId,
              key: assigned.roleKey,
              name: assigned.roleName,
              isSystem: assigned.isSystem,
            }
          : null,
      }
    })

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

    const inviteRoleIds = [
      ...new Set(
        pendingInvitations.map((i) => i.roleId).filter((v): v is NonNullable<typeof v> => v != null)
      ),
    ]
    const inviteRoles = inviteRoleIds.length
      ? await db
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(inArray(roles.id, inviteRoleIds))
      : []
    const inviteRoleNameById = new Map(inviteRoles.map((r) => [r.id, r.name]))

    const formattedInvitations = pendingInvitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      name: inv.name,
      role: inv.role,
      roleId: inv.roleId,
      roleName: inv.roleId ? (inviteRoleNameById.get(inv.roleId) ?? null) : null,
      createdAt: inv.createdAt.toISOString(),
      lastSentAt: inv.lastSentAt?.toISOString() ?? null,
      expiresAt: inv.expiresAt.toISOString(),
    }))

    // Seat line data: same predicate as enforceSeatLimit / the usage report
    // (human admin/member principals), plus the plan cap (null = unlimited).
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const limits = await getTierLimits()
    const [seatRow] = await db
      .select({ count: sqlOp<number>`count(*)`.as('count') })
      .from(principal)
      .where(and(inArray(principal.role, ['admin', 'member']), eq(principal.type, 'user')))
    const seatUsage = {
      used: Number(seatRow?.count ?? 0),
      limit: limits.maxTeamSeats,
    }

    return { members, avatarMap, formattedInvitations, seatUsage }
  }
)

export const fetchUserProfile = createServerFn({ method: 'GET' })
  .validator(userIdSchema)
  .handler(async ({ data }) => {
    log.debug({ user_id: data }, 'fetch user profile')
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
    const { getRegisteredOidcProviderIds } = await import('@/lib/server/auth/registered-providers')
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
  })

// ============================================
// Write Operations
// ============================================

const updateThemeSchema = z.object({
  brandingConfig: z.record(z.string(), z.unknown()),
})

export const updatePortalConfigSchema = z.object({
  features: z
    .object({
      allowAnonymous: z.boolean().optional(),
    })
    .optional(),
  // May a member of the public open an account on the portal? The portal's own
  // answer, distinct from `authConfig.openSignup`, which answers for the team.
  // A `z.object` strips what it does not name, so the key has to be here or the
  // save is accepted and discarded — and the portal has no other writer.
  openSignup: z.boolean().optional(),
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
  nav: z
    .object({
      items: z
        .array(
          z.object({
            id: z.string().min(1).max(64),
            type: z.enum(['feedback', 'roadmap', 'changelog', 'help', 'support', 'status', 'link']),
            enabled: z.boolean().optional(),
            label: z.string().trim().max(30).optional(),
            // http(s) only — blocks javascript:/data: URLs at the boundary.
            url: z
              .string()
              .url()
              .max(2048)
              .refine((u) => /^https?:\/\//i.test(u), 'URL must be http(s)')
              .optional(),
            newTab: z.boolean().optional(),
          })
        )
        .max(20)
        .optional(),
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
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await updateBrandingConfig(data.brandingConfig as BrandingConfig)
  })

export const updatePortalConfigFn = createServerFn({ method: 'POST' })
  .validator(updatePortalConfigSchema)
  .handler(async ({ data }) => {
    log.info('update portal config')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return await updatePortalConfig(data as UpdatePortalConfigInput)
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
        // Both verdicts from one snapshot — gathering them separately would run
        // the uncached provider listing twice on every save.
        const { evaluateProposedSignInMethods, assertBreakGlassAvailable } =
          await import('@/lib/server/auth/sign-in-method-availability')
        const { leavesNoMethod, leavesSsoOnly } = await evaluateProposedSignInMethods(proposedOauth)
        if (leavesNoMethod) {
          const { ConflictError } = await import('@/lib/shared/errors')
          throw new ConflictError(
            'LAST_SIGN_IN_METHOD',
            'Cannot disable the last enabled sign-in method. Enable another method first.'
          )
        }
        // Second route to an SSO-only workspace. Per-domain enforcement already
        // demands a break-glass recovery code; disabling password + magic link
        // here reaches the same end state, so it must demand the same thing.
        if (leavesSsoOnly) {
          await assertBreakGlassAvailable()
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
  })

export const saveLogoKeyFn = createServerFn({ method: 'POST' })
  .validator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    log.info({ key: data.key }, 'save logo key')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await saveLogoKey(data.key)
  })

export const deleteLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('delete logo')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  return await deleteLogoKey()
})

export const saveHeaderLogoKeyFn = createServerFn({ method: 'POST' })
  .validator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    log.info({ key: data.key }, 'save header logo key')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await saveHeaderLogoKey(data.key)
  })

export const deleteHeaderLogoFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('delete header logo')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  return await deleteHeaderLogoKey()
})

export const savePortalOgImageKeyFn = createServerFn({ method: 'POST' })
  .validator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    log.info({ key: data.key }, 'save portal og image key')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await savePortalOgImageKey(data.key)
  })

export const deletePortalOgImageFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('delete portal og image')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  return await deletePortalOgImageKey()
})

export const saveFaviconKeyFn = createServerFn({ method: 'POST' })
  .validator(saveLogoKeySchema)
  .handler(async ({ data }) => {
    log.info({ key: data.key }, 'save favicon key')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await saveFaviconKey(data.key)
  })

export const deleteFaviconFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('delete favicon')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  return await deleteFaviconKey()
})

export const updateHeaderDisplayModeFn = createServerFn({ method: 'POST' })
  .validator(updateHeaderDisplayModeSchema)
  .handler(async ({ data }) => {
    log.info({ mode: data.mode }, 'update header display mode')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await updateHeaderDisplayMode(data.mode)
  })

export const updateHeaderDisplayNameFn = createServerFn({ method: 'POST' })
  .validator(updateHeaderDisplayNameSchema)
  .handler(async ({ data }) => {
    log.info({ name: data.name }, 'update header display name')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await updateHeaderDisplayName(data.name)
  })

const updateWorkspaceNameSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
})

export type UpdateWorkspaceNameInput = z.infer<typeof updateWorkspaceNameSchema>

export const updateWorkspaceNameFn = createServerFn({ method: 'POST' })
  .validator(updateWorkspaceNameSchema)
  .handler(async ({ data }) => {
    log.info({ name: data.name }, 'update workspace name')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await updateWorkspaceName(data.name)
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
  return await getCustomCss()
})

export const updateCustomCssFn = createServerFn({ method: 'POST' })
  .validator(updateCustomCssSchema)
  .handler(async ({ data }) => {
    log.info({ css_length: data.customCss.length }, 'update custom css')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    return await updateCustomCss(data.customCss)
  })

// ============================================
// Developer Config Operations
// ============================================

const updateDeveloperConfigSchema = z.object({
  mcpEnabled: z.boolean().optional(),
  oauthDynamicClientRegistrationEnabled: z.boolean().optional(),
})

export const updateDeveloperConfigFn = createServerFn({ method: 'POST' })
  .validator(updateDeveloperConfigSchema)
  .handler(async ({ data }) => {
    log.info(
      {
        mcp_enabled: data.mcpEnabled,
        oauth_dynamic_client_registration_enabled: data.oauthDynamicClientRegistrationEnabled,
      },
      'update developer config'
    )
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return await updateDeveloperConfig(data)
  })

// ============================================
// Widget Config Operations
// ============================================

export const fetchWidgetConfig = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch widget config')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { getWidgetConfig } = await import('@/lib/server/domains/settings/settings.widget')
  return await getWidgetConfig()
})

export const fetchWidgetSecret = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch widget secret')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { getWidgetSecret } = await import('@/lib/server/domains/settings/settings.widget')
  return await getWidgetSecret()
})

const messengerConfigInputSchema = z.object({
  enabled: z.boolean().optional(),
  welcomeMessage: z.string().max(500).optional(),
  offlineMessage: z.string().max(500).optional(),
  teamName: z.string().max(80).optional(),
  // Refuse visitor replies to closed conversations (Messenger only; §4.3).
  preventRepliesWhenClosed: z.boolean().optional(),
  assistant: z
    .object({
      enabled: z.boolean().optional(),
      // Whether the assistant actually replies (vs. identity-only).
      respond: z.boolean().optional(),
    })
    .optional(),
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
})

// heroImageKey is intentionally absent: the hero image is written only via
// saveWidgetHeroImageKeyFn, which owns the S3 object lifecycle.
// Hex-only (or empty = "use brand color"): these values are interpolated into
// inline styles on the public widget, so the boundary must reject anything
// that could smuggle CSS.
const heroColorSchema = z.union([z.literal(''), z.string().regex(/^#[0-9a-f]{6}$/i)])

const widgetHomeConfigSchema = z.object({
  greeting: z.string().max(120).optional(),
  subtitle: z.string().max(200).optional(),
  headerStyle: z.enum(['plain', 'gradient', 'pattern', 'image']).optional(),
  gradient: z
    .object({
      from: heroColorSchema.optional(),
      to: heroColorSchema.optional(),
    })
    .optional(),
  pattern: z.enum(['dots', 'grid', 'mesh', 'waves']).optional(),
  showLogo: z.boolean().optional(),
  showTeamAvatars: z.boolean().optional(),
  cards: z
    .array(
      z
        .object({
          id: z.string().max(64),
          type: z.enum([
            'feedback',
            'new_conversation',
            'article_search',
            'latest_updates',
            'link',
          ]),
          enabled: z.boolean().optional(),
          audience: z.enum(['everyone', 'anonymous', 'identified']).optional(),
          title: z.string().max(80).optional(),
          subtitle: z.string().max(160).optional(),
          url: z.string().url().max(2000).optional(),
        })
        // A link card without a URL has nowhere to go.
        .refine((c) => c.type !== 'link' || !!c.url, {
          message: 'Link cards require a URL',
        })
    )
    .max(8)
    .optional(),
})

const updateWidgetConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaultBoard: z.string().optional(),
  position: z.enum(['bottom-right', 'bottom-left']).optional(),
  launcherGreeting: z.string().max(120).optional(),
  launcherLabel: z.string().max(60).optional(),
  tabs: z
    .object({
      feedback: z.boolean().optional(),
      changelog: z.boolean().optional(),
      help: z.boolean().optional(),
      messenger: z.boolean().optional(),
      tickets: z.boolean().optional(),
      home: z.boolean().optional(),
    })
    .optional(),
  messenger: messengerConfigInputSchema.optional(),
  home: widgetHomeConfigSchema.optional(),
  translations: z
    .record(
      z.string().max(20),
      z.object({
        welcomeMessage: z.string().max(1000).optional(),
        offlineMessage: z.string().max(1000).optional(),
        greeting: z.string().max(120).optional(),
        subtitle: z.string().max(200).optional(),
      })
    )
    .optional(),
})

export const updateWidgetConfigFn = createServerFn({ method: 'POST' })
  .validator(updateWidgetConfigSchema)
  .handler(async ({ data }) => {
    log.info({ enabled: data.enabled, position: data.position }, 'update widget config')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { updateWidgetConfig } = await import('@/lib/server/domains/settings/settings.widget')
    return await updateWidgetConfig(data)
  })

export const configureWidgetForActivationFn = createServerFn({ method: 'POST' })
  .validator(z.object({ mode: z.enum(['messenger', 'feedback']) }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { configureWidgetForActivation } =
      await import('@/lib/server/domains/settings/settings.widget')
    const configured = await configureWidgetForActivation(data.mode)
    const { emitPlgEvent } = await import('@/lib/server/plg-events')
    await emitPlgEvent(
      {
        name: 'widget_configured',
        outcome: data.mode === 'messenger' ? 'customer_support' : 'product_feedback',
        artifactType: 'widget',
      },
      { workspaceId: auth.settings.id, principalId: auth.principal.id }
    )
    return configured
  })

export const saveWidgetHeroImageKeyFn = createServerFn({ method: 'POST' })
  .validator(z.object({ key: z.string().min(1).max(512) }))
  .handler(async ({ data }) => {
    log.info('save widget hero image key')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { saveWidgetHeroImageKey } = await import('@/lib/server/domains/settings/settings.widget')
    await saveWidgetHeroImageKey(data.key)
  })

export const deleteWidgetHeroImageFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('delete widget hero image')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { deleteWidgetHeroImage } = await import('@/lib/server/domains/settings/settings.widget')
  await deleteWidgetHeroImage()
})

export const regenerateWidgetSecretFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('regenerate widget secret')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { regenerateWidgetSecret } = await import('@/lib/server/domains/settings/settings.widget')
  return await regenerateWidgetSecret()
})

// ============================================
// Office Hours Operations
// ============================================

export const fetchOfficeHoursFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch office hours')
  await requireAuth({ permission: PERMISSIONS.OFFICE_HOURS_MANAGE })
  const { getOfficeHoursSchedule } =
    await import('@/lib/server/domains/settings/settings.office-hours')
  return await getOfficeHoursSchedule()
})

const conversationRoutingSchema = z.object({
  enabled: z.boolean(),
  strategy: z.literal('auto_assign_active'),
})

export const fetchConversationRoutingFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch conversation routing')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { getConversationRouting } =
    await import('@/lib/server/domains/settings/settings.conversation-routing')
  return await getConversationRouting()
})

export const updateConversationRoutingFn = createServerFn({ method: 'POST' })
  .validator(conversationRoutingSchema)
  .handler(async ({ data }) => {
    log.info({ enabled: data.enabled }, 'update conversation routing')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { updateConversationRouting } =
      await import('@/lib/server/domains/settings/settings.conversation-routing')
    return await updateConversationRouting(data)
  })

const emailAutoAckSchema = z.object({ enabled: z.boolean() })

export const fetchEmailAutoAckFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch email auto-ack')
  await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
  const { getEmailAutoAck } = await import('@/lib/server/domains/settings/settings.email-auto-ack')
  return await getEmailAutoAck()
})

export const updateEmailAutoAckFn = createServerFn({ method: 'POST' })
  .validator(emailAutoAckSchema)
  .handler(async ({ data }) => {
    log.info({ enabled: data.enabled }, 'update email auto-ack')
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const { updateEmailAutoAck } =
      await import('@/lib/server/domains/settings/settings.email-auto-ack')
    return await updateEmailAutoAck(data)
  })

export const updateOfficeHoursFn = createServerFn({ method: 'POST' })
  .validator(officeHoursScheduleSchema)
  .handler(async ({ data }) => {
    log.info({ enabled: data.enabled, intervals: data.intervals.length }, 'update office hours')
    await requireAuth({ permission: PERMISSIONS.OFFICE_HOURS_MANAGE })
    const { updateOfficeHoursSchedule } =
      await import('@/lib/server/domains/settings/settings.office-hours')
    return await updateOfficeHoursSchedule(data)
  })

// ============================================
// Changelog Settings Operations
// ============================================

export const fetchChangelogSettingsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch changelog settings')
  await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
  const { getChangelogSettings } = await import('@/lib/server/domains/settings/settings.changelog')
  return await getChangelogSettings()
})

export const updateChangelogSettingsFn = createServerFn({ method: 'POST' })
  .validator(changelogSettingsSchema)
  .handler(async ({ data }) => {
    log.info(data, 'update changelog settings')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    const { updateChangelogSettings } =
      await import('@/lib/server/domains/settings/settings.changelog')
    return await updateChangelogSettings(data)
  })

// ============================================
// Abandoned-Journey Auto-Close Operations
// ============================================

// Gated like the rest of the automation page these settings live on
// (functions/workflows.ts's precedent: read = ROUTING_MANAGE, write =
// WORKFLOW_MANAGE), NOT settings.manage — a custom role holding only those
// two (the page's actual read/write split) still needs its route loader's
// fetch to succeed.
export const fetchWorkflowAbandonedAutoCloseFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    log.debug('fetch workflow abandoned auto-close settings')
    await requireAuth({ permission: PERMISSIONS.ROUTING_MANAGE })
    const { getWorkflowAbandonedAutoCloseSettings } =
      await import('@/lib/server/domains/settings/settings.workflows')
    return await getWorkflowAbandonedAutoCloseSettings()
  }
)

export const updateWorkflowAbandonedAutoCloseFn = createServerFn({ method: 'POST' })
  .validator(workflowAbandonedAutoCloseSchema)
  .handler(async ({ data }) => {
    log.info(data, 'update workflow abandoned auto-close settings')
    await requireAuth({ permission: PERMISSIONS.WORKFLOW_MANAGE })
    const { updateWorkflowAbandonedAutoCloseSettings } =
      await import('@/lib/server/domains/settings/settings.workflows')
    return await updateWorkflowAbandonedAutoCloseSettings(data)
  })

export const fetchWorkflowCloseSpamFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch workflow close-spam settings')
  await requireAuth({ permission: PERMISSIONS.ROUTING_MANAGE })
  const { getWorkflowCloseSpamSettings } =
    await import('@/lib/server/domains/settings/settings.workflows')
  return await getWorkflowCloseSpamSettings()
})

export const updateWorkflowCloseSpamFn = createServerFn({ method: 'POST' })
  .validator(workflowCloseSpamSchema)
  .handler(async ({ data }) => {
    log.info(data, 'update workflow close-spam settings')
    await requireAuth({ permission: PERMISSIONS.WORKFLOW_MANAGE })
    const { updateWorkflowCloseSpamSettings } =
      await import('@/lib/server/domains/settings/settings.workflows')
    return await updateWorkflowCloseSpamSettings(data)
  })

// ============================================
// Default SLA policy
// ============================================

export const fetchDefaultSlaPolicyFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch default SLA policy settings')
  await requireAuth({ permission: PERMISSIONS.SLA_MANAGE })
  const { getDefaultSlaPolicySettings } =
    await import('@/lib/server/domains/settings/settings.sla-default')
  return await getDefaultSlaPolicySettings()
})

export const updateDefaultSlaPolicyFn = createServerFn({ method: 'POST' })
  .validator(defaultSlaPolicySchema)
  .handler(async ({ data }) => {
    log.info(data, 'update default SLA policy settings')
    await requireAuth({ permission: PERMISSIONS.SLA_MANAGE })
    const { updateDefaultSlaPolicySettings } =
      await import('@/lib/server/domains/settings/settings.sla-default')
    return await updateDefaultSlaPolicySettings(data)
  })

// ============================================
// Spam-Filter Trusted Senders
// ============================================

const updateSpamFilterConfigSchema = z.object({
  trustedSenders: z.array(z.string().max(320)).max(MAX_TRUSTED_SENDERS),
})

/** The spam filter's trusted-sender list (admin read, for the settings UI). */
export const getSpamFilterConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('get spam filter config')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { getSpamFilterConfig } = await import('@/lib/server/domains/settings/settings.spam')
  return await getSpamFilterConfig()
})

/** Replace the trusted-sender list wholesale (add/remove are list rewrites). */
export const updateSpamFilterConfigFn = createServerFn({ method: 'POST' })
  .validator(updateSpamFilterConfigSchema)
  .handler(async ({ data }) => {
    log.info({ trusted_count: data.trustedSenders.length }, 'update spam filter config')
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { updateSpamFilterConfig } = await import('@/lib/server/domains/settings/settings.spam')
    return await updateSpamFilterConfig(data)
  })

// ============================================
// Moderation Default Operations
// ============================================

const moderationDefaultSchema = z.object({
  requireApproval: z.enum(['none', 'anonymous', 'authenticated', 'all']),
  holdImages: z.boolean().optional(),
  holdLinks: z.boolean().optional(),
})

/**
 * Read-only status of the conversation email channel (admin-only). Reports
 * which outbound provider the environment resolves to, the from-address, and
 * whether inbound reply threading is configured — names only, never secrets.
 */
export const getEmailChannelStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('get email channel status')
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { getEmailProvider } = await import('@quackback/email')
  const { isEmailInboundConfigured, inboundMintDomain } =
    await import('@/lib/server/domains/conversation/conversation.email-channel')
  return {
    provider: getEmailProvider(),
    fromAddress: process.env.EMAIL_FROM ?? null,
    inboundConfigured: isEmailInboundConfigured(),
    // The domain as every reader of it resolves it, not as it was typed. A value
    // naming no single domain resolves to none, so this surface reports the
    // channel unconfigured rather than echoing a string nothing can receive on.
    inboundDomain: inboundMintDomain(),
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
