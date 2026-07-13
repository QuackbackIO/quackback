import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { UserId, PostStatusId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import {
  ONBOARDING_OUTCOMES,
  DEFAULT_SETUP_STATE,
  type OnboardingOutcome,
  type SetupState,
} from '@/lib/server/db'
import { isAdmin } from '@/lib/shared/roles'
import { getSession } from '@/lib/server/auth/session'
import { getSettings } from './workspace'
import { syncPrincipalProfile } from '@/lib/server/domains/principals/principal.service'
import {
  ensurePrincipalForUser,
  setPrincipalRole,
} from '@/lib/server/domains/principals/principal.factory'
import {
  db,
  settings,
  principal,
  user,
  postStatuses,
  eq,
  and,
  sql,
  DEFAULT_STATUSES,
} from '@/lib/server/db'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { slugify } from '@/lib/shared/utils'
import { getSetupState } from '@/lib/shared/db-types'
import { logger } from '@/lib/server/logger'
import { mutateSetupStateAtomic } from '@/lib/server/setup-state'

const log = logger.child({ component: 'onboarding' })

/** The combined workspace-and-goal step promotes the first user to admin,
 *  or verifies that an admin already owns setup. */
async function ensureBootstrapAdmin(userId: UserId): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize the one-time bootstrap decision so two first users cannot both
    // observe an empty admin set and promote themselves concurrently.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('onboarding-admin', 0))`)

    const caller = await tx.query.principal.findFirst({
      where: eq(principal.userId, userId),
    })
    if (caller && isAdmin(caller.role)) return

    // Bootstrap promotion is only valid until the first human admin exists.
    const existingAdmin = await tx.query.principal.findFirst({
      where: and(eq(principal.role, 'admin'), eq(principal.type, 'user')),
    })
    if (existingAdmin) {
      throw new Error('Workspace setup is already claimed by an admin')
    }

    const { created, principal: p } = await ensurePrincipalForUser({ userId, role: 'admin' }, tx)
    if (!created && !isAdmin(p.role)) {
      log.debug({ user_id: userId }, 'upgrading user to admin')
      await setPrincipalRole({ userId }, 'admin', { executor: tx, knownUserId: userId })
    }
  })
}

/**
 * Server functions for onboarding workflow.
 */

// ============================================
// Schemas
// ============================================

const saveWorkspaceAndGoalSchema = z.object({
  workspaceName: z
    .string()
    .min(2, 'Workspace name must be at least 2 characters')
    .max(100, 'Workspace name must be 100 characters or less'),
  userName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be 100 characters or less')
    .optional(),
  useCase: z.enum(ONBOARDING_OUTCOMES),
})

// ============================================
// Type Exports
// ============================================

export type SaveWorkspaceAndGoalInput = z.infer<typeof saveWorkspaceAndGoalSchema>

export interface SaveWorkspaceAndGoalResult {
  id: string
  name: string
  slug: string
  useCase: OnboardingOutcome
  managed: { name: boolean; slug: boolean; useCase: boolean }
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
export const saveWorkspaceAndGoalFn = createServerFn({ method: 'POST' })
  .validator(saveWorkspaceAndGoalSchema)
  .handler(
    async ({ data }: { data: SaveWorkspaceAndGoalInput }): Promise<SaveWorkspaceAndGoalResult> => {
      log.debug(
        { workspace_name: data.workspaceName, use_case: data.useCase },
        'save workspace and goal'
      )
      try {
        const session = await getSession()
        if (!session?.user) throw new Error('Authentication required')

        const workspaceName = data.workspaceName.trim()
        const slug = slugify(workspaceName)
        if (slug.length < 2) throw new Error('Invalid workspace name - cannot generate valid slug')
        const existingSettings = await getSettings()
        const setupState = getSetupState(existingSettings?.setupState ?? null)

        if (existingSettings && setupState?.steps.workspace) {
          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.userId, session.user.id as UserId),
          })
          if (!principalRecord || !isAdmin(principalRecord.role))
            throw new Error('Only admin can change setup')
        } else {
          await ensureBootstrapAdmin(session.user.id as UserId)
        }

        if (data.userName) {
          await db
            .update(user)
            .set({ name: data.userName.trim(), updatedAt: new Date() })
            .where(eq(user.id, session.user.id as UserId))
          await syncPrincipalProfile(session.user.id as UserId, {
            displayName: data.userName.trim(),
          })
        }

        let result: SaveWorkspaceAndGoalResult
        if (!existingSettings) {
          const initialState: SetupState = {
            ...DEFAULT_SETUP_STATE,
            steps: { ...DEFAULT_SETUP_STATE.steps, workspace: true },
            useCase: data.useCase,
          }
          const [created] = await db
            .insert(settings)
            .values({
              id: generateId('workspace'),
              name: workspaceName,
              slug,
              createdAt: new Date(),
              portalConfig: JSON.stringify(DEFAULT_PORTAL_CONFIG),
              authConfig: JSON.stringify({ ...DEFAULT_AUTH_CONFIG, openSignup: true }),
              setupState: JSON.stringify(initialState),
            })
            .returning()
          await invalidateSettingsCache()
          result = {
            id: created.id,
            name: created.name,
            slug: created.slug,
            useCase: data.useCase,
            managed: { name: false, slug: false, useCase: false },
          }
        } else {
          const { value } = await mutateSetupStateAtomic(async (current, row, tx) => {
            const nameManaged = isPathManaged('workspace.name', row.managedFieldPaths)
            const slugManaged = isPathManaged('workspace.slug', row.managedFieldPaths)
            const useCaseManaged = isPathManaged('workspace.useCase', row.managedFieldPaths)
            if (nameManaged && workspaceName !== row.name) {
              throw new Error('Workspace name is managed by your workspace admin')
            }
            if (useCaseManaged && data.useCase !== current.useCase) {
              throw new Error('Workspace goal is managed by your workspace admin')
            }
            const updatePayload: Record<string, unknown> = {
              portalConfig: row.portalConfig ?? JSON.stringify(DEFAULT_PORTAL_CONFIG),
              authConfig:
                row.authConfig ?? JSON.stringify({ ...DEFAULT_AUTH_CONFIG, openSignup: true }),
            }
            if (!nameManaged) updatePayload.name = workspaceName
            if (!slugManaged) updatePayload.slug = slug
            const [updated] = await tx
              .update(settings)
              .set(updatePayload)
              .where(eq(settings.id, row.id))
              .returning()
            const goal = useCaseManaged ? (current.useCase ?? data.useCase) : data.useCase
            return {
              state: {
                ...current,
                steps: { ...current.steps, workspace: true },
                useCase: goal,
              },
              value: {
                updated,
                goal,
                managed: { name: nameManaged, slug: slugManaged, useCase: useCaseManaged },
              },
            }
          })
          result = {
            id: value.updated.id,
            name: value.updated.name,
            slug: value.updated.slug,
            useCase: value.goal,
            managed: value.managed,
          }
        }

        const existingStatuses = await db.query.postStatuses.findFirst()
        if (!existingStatuses) {
          const statusValues = DEFAULT_STATUSES.map((status) => ({
            id: generateId('post_status') as PostStatusId,
            ...status,
            createdAt: new Date(),
          }))
          await db.insert(postStatuses).values(statusValues)
          log.info({ count: statusValues.length }, 'setup workspace: created default statuses')
        }

        log.info({ workspace_id: result.id, slug: result.slug }, 'save workspace and goal complete')
        return result
      } catch (error) {
        log.error({ err: error }, 'save workspace and goal failed')
        throw error
      }
    }
  )

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
