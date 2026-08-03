import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { UserId, StatusId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { USE_CASE_TYPES, type SetupState, type UseCaseType } from '@/lib/server/db'
import { isAdmin } from '@/lib/shared/roles'
import { getSession } from '@/lib/server/auth/session'
import { getSettings } from './workspace'
import { syncPrincipalProfile } from '@/lib/server/domains/principals/principal.service'
import { listBoards } from '@/lib/server/domains/boards/board.service'
import { db, settings, principal, user, postStatuses, eq, DEFAULT_STATUSES } from '@/lib/server/db'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings'
import { assertNotManaged } from '@/lib/server/config-file/managed-guard'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { slugify } from '@/lib/shared/utils'
import { getSetupState } from '@/lib/shared/db-types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'onboarding' })

/** Onboarding promotes the acting user to admin in two server fns
 *  (saveUseCaseFn, setupWorkspaceFn). Same DB shape, same intent —
 *  insert when missing, upgrade when present-but-not-admin. */
async function ensureAdminPrincipal(userId: UserId): Promise<void> {
  const existing = await db.query.principal.findFirst({
    where: eq(principal.userId, userId),
  })
  if (!existing) {
    log.debug({ user_id: userId }, 'creating admin member')
    await db.insert(principal).values({
      id: generateId('principal'),
      userId,
      role: 'admin',
      createdAt: new Date(),
    })
  } else if (!isAdmin(existing.role)) {
    log.debug({ user_id: userId }, 'upgrading user to admin')
    await db.update(principal).set({ role: 'admin' }).where(eq(principal.userId, userId))
  }
}

/**
 * Server functions for onboarding workflow.
 */

// ============================================
// Schemas
// ============================================

const setupWorkspaceSchema = z.object({
  workspaceName: z
    .string()
    .min(2, 'Workspace name must be at least 2 characters')
    .max(100, 'Workspace name must be 100 characters or less'),
  userName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be 100 characters or less')
    .optional(),
  useCase: z.enum(USE_CASE_TYPES).optional(),
})

// ============================================
// Type Exports
// ============================================

export type SetupWorkspaceInput = z.infer<typeof setupWorkspaceSchema>

export interface SetupWorkspaceResult {
  id: string
  name: string
  slug: string
}

// ============================================
// Server Functions
// ============================================

/**
 * Setup workspace during onboarding.
 * Creates settings and default statuses.
 * Requires authentication. For fresh installs (no settings), makes the user admin.
 *
 * NOTE: Cannot use requireAuth() here because it requires settings to exist,
 * but we're creating settings. We manually check auth and handle member creation.
 */
export const setupWorkspaceFn = createServerFn({ method: 'POST' })
  .validator(setupWorkspaceSchema)
  .handler(async ({ data }: { data: SetupWorkspaceInput }): Promise<SetupWorkspaceResult> => {
    log.debug({ workspace_name: data.workspaceName }, 'setup workspace: entry')
    try {
      // Check authentication manually (can't use requireAuth - it needs settings to exist)
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      // Block in-app writes when the config-file owns these fields.
      // The reconciler applies the file's value separately; this gate
      // refuses to let the UI clobber it. Pre-onboarding the gate is a
      // no-op because settings (and managedFieldPaths) don't exist yet
      // — by the time managedFieldPaths is populated the reconciler
      // has already written the file's name/slug.
      //
      // Slug-only lock: when the file owns slug but not name, the name
      // input still accepts user submission (the wizard auto-derives
      // slug client-side, but the server skips the slug column write
      // below). This avoids locking the user out of onboarding when
      // only one of the two fields is managed.
      await assertNotManaged('workspace.name')
      if (data.useCase !== undefined) {
        await assertNotManaged('workspace.useCase')
      }

      const { workspaceName, userName, useCase } = data

      // Check if settings already exist
      const existingSettings = await getSettings()

      let setupState: SetupState | null = getSetupState(existingSettings?.setupState ?? null)

      // Fresh install (no settings): first authenticated user becomes admin.
      // Settings exist + workspace step done: require existing admin.
      // Settings exist + workspace step not done: ensure user becomes admin.
      if (!existingSettings) {
        await ensureAdminPrincipal(session.user.id as UserId)
      } else if (setupState?.steps?.workspace) {
        const principalRecord = await db.query.principal.findFirst({
          where: eq(principal.userId, session.user.id as UserId),
        })
        if (!principalRecord || !isAdmin(principalRecord.role)) {
          throw new Error('Only admin can complete setup')
        }
      } else {
        await ensureAdminPrincipal(session.user.id as UserId)
      }

      // Check if onboarding is already complete
      if (setupState?.steps?.core && setupState?.steps?.workspace && setupState?.steps?.boards) {
        throw new Error('Workspace already initialized')
      }

      // Update user's name if provided (for users created via magic link without a name)
      if (userName) {
        await db
          .update(user)
          .set({
            name: userName.trim(),
            updatedAt: new Date(),
          })
          .where(eq(user.id, session.user.id as UserId))
        await syncPrincipalProfile(session.user.id as UserId, { displayName: userName.trim() })
      }

      let finalSettings = existingSettings

      // Settings exist: update name/slug and mark workspace step complete
      if (existingSettings) {
        log.debug('setup workspace: updating existing settings')

        // Slug is auto-derived from name client-side, but if the
        // config file owns workspace.slug we skip the column write and
        // let the file's slug stand. The reconciler will overwrite it
        // on its next tick anyway.
        const slugManaged = isPathManaged('workspace.slug', existingSettings.managedFieldPaths)
        const slug = slugify(workspaceName)

        if (!slugManaged && slug.length < 2) {
          throw new Error('Invalid workspace name - cannot generate valid slug')
        }

        // Update setupState to mark workspace step as complete
        if (setupState && !setupState.steps.workspace) {
          const updatedState: SetupState = {
            ...setupState,
            steps: {
              ...setupState.steps,
              workspace: true,
            },
            useCase: useCase ?? setupState.useCase,
          }
          const updatePayload: Record<string, unknown> = {
            name: workspaceName.trim(),
            setupState: JSON.stringify(updatedState),
            // Seed defaults only when the column is still null — never
            // clobber values the admin (or config-file reconciler) has
            // already written. openSignup is forced true here so the
            // first admin doesn't lock the team surface immediately
            // after creating the workspace; DEFAULT_AUTH_CONFIG ships
            // false because steady-state tenants don't want anyone to
            // self-serve sign-up.
            portalConfig: existingSettings.portalConfig ?? JSON.stringify(DEFAULT_PORTAL_CONFIG),
            authConfig:
              existingSettings.authConfig ??
              JSON.stringify({ ...DEFAULT_AUTH_CONFIG, openSignup: true }),
          }
          if (!slugManaged) updatePayload.slug = slug
          const [updated] = await db
            .update(settings)
            .set(updatePayload)
            .where(eq(settings.id, existingSettings.id))
            .returning()
          finalSettings = updated
          log.info(
            { workspace_name: workspaceName, slug_managed: slugManaged },
            'setup workspace: settings updated'
          )
        }
      } else {
        // Self-hosted: create settings from scratch
        // Generate slug from workspace name
        const slug = slugify(workspaceName)

        if (slug.length < 2) {
          throw new Error('Invalid workspace name - cannot generate valid slug')
        }

        // Workspace step is done by the time this fn returns; boards
        // step still pending until the user creates / skips one.
        setupState = {
          version: 1,
          steps: {
            core: true,
            workspace: true,
            boards: false,
          },
          source: 'self-hosted',
          useCase,
        }

        // Create settings
        // Note: Not using transaction because neon-http driver doesn't support interactive transactions.
        //
        // Fresh-insert intentionally bypasses the managed-paths gate:
        // there's no settings row yet to read managedFieldPaths from,
        // so assertNotManaged would have nothing to assert against. If
        // a config file is present, the reconciler will overwrite
        // name/slug/etc on its next tick and populate managedFieldPaths
        // — subsequent UI mutators are gated normally.
        const [createdSettings] = await db
          .insert(settings)
          .values({
            id: generateId('workspace'),
            name: workspaceName.trim(),
            slug,
            createdAt: new Date(),
            portalConfig: JSON.stringify(DEFAULT_PORTAL_CONFIG),
            // openSignup forced true at first-install so the bootstrap
            // admin doesn't lock the team surface immediately; the
            // shipped default is false (settings.types.ts).
            authConfig: JSON.stringify({ ...DEFAULT_AUTH_CONFIG, openSignup: true }),
            setupState: JSON.stringify(setupState),
          })
          .returning()

        finalSettings = createdSettings
        log.info('setup workspace: created settings')
      }

      // Create default post statuses if none exist
      const existingStatuses = await db.query.postStatuses.findFirst()
      if (!existingStatuses) {
        const statusValues = DEFAULT_STATUSES.map((status) => ({
          id: generateId('status') as StatusId,
          ...status,
          createdAt: new Date(),
        }))
        await db.insert(postStatuses).values(statusValues)
        log.info({ count: statusValues.length }, 'setup workspace: created default statuses')
      }

      await invalidateSettingsCache()
      log.info(
        { workspace_id: finalSettings!.id, slug: finalSettings!.slug },
        'setup workspace: complete'
      )
      return {
        id: finalSettings!.id,
        name: finalSettings!.name,
        slug: finalSettings!.slug,
      }
    } catch (error) {
      log.error({ err: error }, 'setup workspace failed')
      throw error
    }
  })

/**
 * Save user name during onboarding.
 * Called after OTP verification if user doesn't have a name set.
 */
export const saveUserNameFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(2, 'Name must be at least 2 characters').max(100),
    })
  )
  .handler(async ({ data }: { data: { name: string } }): Promise<void> => {
    log.debug('save user name: entry')
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      await db
        .update(user)
        .set({
          name: data.name.trim(),
          updatedAt: new Date(),
        })
        .where(eq(user.id, session.user.id as UserId))
      await syncPrincipalProfile(session.user.id as UserId, { displayName: data.name.trim() })

      log.info({ user_id: session.user.id }, 'save user name: saved')
    } catch (error) {
      log.error({ err: error }, 'save user name failed')
      throw error
    }
  })

/**
 * Save use case selection during onboarding.
 * Stores the use case in setupState for board recommendations.
 * For fresh installs, creates minimal settings to store the useCase.
 */
export const saveUseCaseFn = createServerFn({ method: 'POST' })
  .validator(z.object({ useCase: z.enum(USE_CASE_TYPES) }))
  .handler(async ({ data }: { data: { useCase: UseCaseType } }): Promise<void> => {
    log.debug({ use_case: data.useCase }, 'save use case: entry')
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      // Same rationale as setupWorkspaceFn: don't let the UI overwrite
      // a file-managed useCase. Pre-onboarding the gate is a no-op.
      await assertNotManaged('workspace.useCase')

      const existingSettings = await getSettings()

      if (existingSettings) {
        const setupState: SetupState = getSetupState(existingSettings.setupState) ?? {
          version: 1,
          steps: { core: true, workspace: false, boards: false },
          source: 'self-hosted',
        }

        const updatedState: SetupState = { ...setupState, useCase: data.useCase }

        await db
          .update(settings)
          .set({ setupState: JSON.stringify(updatedState) })
          .where(eq(settings.id, existingSettings.id))

        if (!setupState.steps.workspace) {
          await ensureAdminPrincipal(session.user.id as UserId)
        }

        await invalidateSettingsCache()
        log.info({ use_case: data.useCase }, 'save use case: saved')
      } else {
        // Fresh install: create minimal settings to store useCase. The
        // workspace step will update name/slug later.
        //
        // Fresh-insert intentionally bypasses the managed-paths gate
        // (same rationale as setupWorkspaceFn): no settings row yet to
        // read managedFieldPaths from. The reconciler will overwrite on
        // its next tick if the file owns these fields.
        const setupState: SetupState = {
          version: 1,
          steps: { core: true, workspace: false, boards: false },
          source: 'self-hosted',
          useCase: data.useCase,
        }

        await db.insert(settings).values({
          id: generateId('workspace'),
          name: 'My Workspace', // Placeholder, will be updated in workspace step
          slug: 'workspace',
          createdAt: new Date(),
          setupState: JSON.stringify(setupState),
        })

        await ensureAdminPrincipal(session.user.id as UserId)

        await invalidateSettingsCache()
        log.info({ use_case: data.useCase }, 'save use case: created initial settings')
      }
    } catch (error) {
      log.error({ err: error }, 'save use case failed')
      throw error
    }
  })

/**
 * List existing boards during onboarding plus the tenant's maxBoards
 * tier limit. The wizard's boards step uses both — the first to
 * display existing boards as completed, the second to render the
 * selector as radio-style (single-select) when only one board fits.
 */
export const listBoardsForOnboarding = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list boards for onboarding: entry')
  try {
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const [boardList, limits] = await Promise.all([listBoards(), getTierLimits()])
    return {
      boards: boardList.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
      })),
      maxBoards: limits.maxBoards,
    }
  } catch (error) {
    log.error({ err: error }, 'list boards for onboarding failed')
    return { boards: [], maxBoards: null }
  }
})
