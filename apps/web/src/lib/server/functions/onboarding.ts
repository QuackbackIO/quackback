import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { UserId, PostStatusId, PrincipalId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import {
  ONBOARDING_OUTCOMES,
  DEFAULT_SETUP_STATE,
  type OnboardingOutcome,
  type SetupState,
} from '@/lib/server/db'
import { isAdmin, toSessionScope } from '@/lib/shared/roles'
import { getSession } from '@/lib/server/auth/session'
import { getSettings } from './workspace'
import { syncPrincipalProfile } from '@/lib/server/domains/principals/principal.service'
import {
  ensurePrincipalForUser,
  setPrincipalRole,
} from '@/lib/server/domains/principals/principal.factory'
import {
  bootstrapAdminLock,
  findHumanAdmin,
  isOpenToBootstrapClaim,
  isSetupOpenToClaim,
} from '@/lib/server/domains/principals/bootstrap-admin'
import { db, settings, principal, user, postStatuses, eq, DEFAULT_STATUSES } from '@/lib/server/db'
import { isOnboardingComplete } from '@/lib/shared/db-types'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import {
  DEFAULT_AUTH_CONFIG,
  NEW_WORKSPACE_FEATURE_FLAGS,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  flagsForGoals,
  resolveFeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { slugify } from '@/lib/shared/utils/slugify'
import { getSetupState } from '@/lib/shared/db-types'
import { logger } from '@/lib/server/logger'
import {
  applyDeferredLaunchStartingPoint,
  finishIdentityOnboarding,
  mutateSetupStateAtomic,
} from '@/lib/server/setup-state'
import {
  applyOnboardingGoals,
  prepareOnboardingBoard,
  setupGoals,
} from '@/lib/server/onboarding-board'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'

const log = logger.child({ component: 'onboarding' })

/** Refusal for a workspace whose owner is decided somewhere other than here. */
export const NOT_OPEN_TO_CLAIM_MESSAGE =
  'This workspace is not open to be set up here. Sign in with the account it was created for.'

/** Refusal for a claim on a workspace whose setup is already finished. */
export const SETUP_ALREADY_COMPLETE_MESSAGE =
  'This workspace is already set up. Sign in with an admin account.'

/**
 * The one place a workspace's first admin is created, and the one place the
 * workspace step's authorization is decided. Four answers, in order: an admin
 * caller passes, a caller who is not the existing owner is refused, a caller on
 * a workspace that is not open to be claimed is refused, and a caller on an
 * unclaimed install nobody provisioned claims it.
 *
 * Reached only from the workspace step, where the caller has explicitly asked
 * to set this workspace up. Nothing that merely reports state may promote:
 * a loader runs on every page load, so a promoting reporter hands admin to
 * whoever loads the page first.
 */
async function ensureBootstrapAdmin(userId: UserId): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize the one-time bootstrap decision so two first users cannot both
    // observe an empty admin set and promote themselves concurrently.
    await tx.execute(bootstrapAdminLock())

    const caller = await tx.query.principal.findFirst({
      where: eq(principal.userId, userId),
    })
    if (caller && isAdmin(caller.role)) return

    // Bootstrap promotion is only valid until the first human admin exists.
    const existingAdmin = await findHumanAdmin(tx)
    if (existingAdmin) {
      throw new Error('Workspace setup is already claimed by an admin')
    }

    // Nobody owns it — which on a provisioned workspace is a statement about
    // the owner not having arrived yet, not an invitation to become them.
    // Asked on `tx` so it is decided inside the same lock window as the two
    // questions above rather than alongside them.
    if (!(await isOpenToBootstrapClaim(tx))) {
      log.warn({ user_id: userId }, 'bootstrap admin promotion refused: workspace is provisioned')
      throw new Error(NOT_OPEN_TO_CLAIM_MESSAGE)
    }

    // A finished workspace with no human admin left is not unclaimed setup.
    // Claiming is how setup gets finished, so once it is finished nobody
    // claims it by arriving, however its admins came to be gone.
    if (!(await isSetupOpenToClaim(tx))) {
      log.warn({ user_id: userId }, 'bootstrap admin promotion refused: setup is complete')
      throw new Error(SETUP_ALREADY_COMPLETE_MESSAGE)
    }

    const { created, principal: p } = await ensurePrincipalForUser({ userId, role: 'admin' }, tx)
    if (!created && !isAdmin(p.role)) {
      await setPrincipalRole({ userId }, 'admin', { executor: tx, knownUserId: userId })
    }
    // Both branches hand out the same authority, so both are worth the same
    // line in the log: this is the only record that a workspace was claimed.
    log.info({ user_id: userId, created }, 'bootstrap admin promotion')
  })
}

/**
 * Server functions for onboarding workflow.
 */

/** Whether a human admin already owns this workspace's setup. */
export interface WorkspaceClaim {
  claimed: boolean
  /**
   * Whether the workspace's own pages are reachable yet. Until setup
   * finishes, the root gate returns the portal root to the wizard, so the
   * claim screen can only offer a way out once this is true.
   */
  setupComplete: boolean
  /**
   * Whether arriving here is still a way to become this workspace's admin.
   *
   * False on a workspace a control plane provisioned, whose owner is recorded
   * where it was created, and on a workspace whose setup is already finished.
   * A screen that offered account creation on such a workspace would be
   * offering a path the promoter refuses, which is the disagreement this whole
   * answer exists to prevent.
   */
  openToClaim: boolean
  /**
   * Why {@link openToClaim} is false, so the screen can say the true thing:
   * `provisioned` (created for a named account) or `setupComplete` (already
   * set up; an admin signs in). Null while it is open.
   */
  closedReason: 'provisioned' | 'setupComplete' | null
}

/**
 * Reports whether this workspace's setup is already claimed, for the
 * unauthenticated first screen.
 *
 * The signals are the same ones {@link ensureBootstrapAdmin} decides on: an
 * owner is a principal that is a human (`type: 'user'`) and an admin, and a
 * workspace is open to be claimed only when no control plane created it. A
 * workspace that arrives with an owner already seeded reads `claimed: true` and
 * its first screen offers sign-in; a provisioned one whose owner has not
 * arrived reads `openToClaim: false` and offers sign-in too, because there is
 * no account for a stranger to create here; an install that starts empty reads
 * `claimed: false` with `openToClaim: true` and keeps the account-creation form
 * it has always had.
 *
 * Deliberately unauthenticated, because the visitor it exists for has no
 * session yet. It answers one question about the workspace as a whole and
 * never about any person, so it is not an account-presence oracle: the answer
 * is identical for every visitor.
 *
 * It deliberately says nothing about WHO the owner is. Everything a loader
 * returns is dehydrated into the SSR document, so an owner hint would be a
 * single unauthenticated GET away for anyone who can guess the hostname, and
 * the local part plus the whole corporate domain is a working target at the
 * moment that person is expecting setup mail. The same rule already governs
 * {@link checkOnboardingState} and the auth-method lookup.
 */
export const getWorkspaceClaimFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WorkspaceClaim> => {
    // Existence only, on the same predicates the promoter guards with, so the
    // screen and the promoter can never disagree about who owns setup or about
    // whether it is still there to be taken.
    const [owner, unprovisioned, setupOpen] = await Promise.all([
      findHumanAdmin(db),
      isOpenToBootstrapClaim(db),
      isSetupOpenToClaim(db),
    ])

    const current = await getSettings()
    const setupComplete = isOnboardingComplete(getSetupState(current?.setupState ?? null))

    // Same order the promoter refuses in: provenance first, then setup state.
    const closedReason = !unprovisioned ? 'provisioned' : !setupOpen ? 'setupComplete' : null
    return { claimed: !!owner, setupComplete, openToClaim: closedReason === null, closedReason }
  }
)

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
  useCase: z.enum(ONBOARDING_OUTCOMES).optional(),
  goals: z.array(z.enum(ONBOARDING_OUTCOMES)).min(1).max(4).optional(),
  feedbackPrivate: z.boolean().optional(),
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
  enabledModules: string[]
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
        { workspace_name: data.workspaceName, use_case: data.useCase ?? 'product_feedback' },
        'save workspace and goal'
      )
      const session = await getSession()
      if (!session?.user) throw new Error('Authentication required')
      if (session.session.scope !== 'dashboard') throw new Error('Only admin can change setup')

      const workspaceName = data.workspaceName.trim()
      const slug = slugify(workspaceName)
      if (slug.length < 2) throw new Error('Invalid workspace name - cannot generate valid slug')
      const goals = [...new Set(data.goals ?? [data.useCase ?? 'product_feedback'])]
      const useCase = goals[0]
      const feedbackPrivate = data.feedbackPrivate ?? data.useCase === 'internal'
      const existingSettings = await getSettings()

      // Who owns setup decides this, not what the setup state says. An earlier
      // revision gated on whether the workspace step was already stamped, and
      // the declarative config file stamps that before anyone has ever signed
      // in: a stamp is not an owner, so a pre-stamped workspace refused its own
      // first user here, and the only thing promoting them was a loader that
      // had no business writing at all.
      //
      // The unlocked read below only picks the branch. The claim branch decides
      // again under the bootstrap lock, so two simultaneous first users still
      // end with exactly one admin and a refusal for the loser.
      if (await findHumanAdmin(db)) {
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
        const initialState: SetupState = finishIdentityOnboarding(
          {
            ...DEFAULT_SETUP_STATE,
            goals,
            feedbackPrivate,
            steps: { ...DEFAULT_SETUP_STATE.steps, workspace: true },
          },
          useCase
        )
        const { flags, enabledModules } = flagsForGoals(NEW_WORKSPACE_FEATURE_FLAGS, goals)
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(settings)
            .values({
              id: generateId('workspace'),
              name: workspaceName,
              slug,
              createdAt: new Date(),
              portalConfig: JSON.stringify(DEFAULT_PORTAL_CONFIG),
              widgetConfig: JSON.stringify(DEFAULT_WIDGET_CONFIG),
              assistantConfig: DEFAULT_ASSISTANT_CONFIG,
              authConfig: JSON.stringify({ ...DEFAULT_AUTH_CONFIG, openSignup: true }),
              setupState: JSON.stringify(initialState),
              featureFlags: JSON.stringify(flags),
            })
            .returning()
          if (!row) throw new Error('Failed to create workspace settings')
          await prepareOnboardingBoard(tx, initialState)
          return row
        })
        await invalidateSettingsCache()
        result = {
          id: created.id,
          name: created.name,
          slug: created.slug,
          useCase,
          managed: { name: false, slug: false, useCase: false },
          enabledModules,
        }
      } else {
        const { value } = await mutateSetupStateAtomic(async (current, row, tx) => {
          const nameManaged = isPathManaged('workspace.name', row.managedFieldPaths)
          const slugManaged = isPathManaged('workspace.slug', row.managedFieldPaths)
          const useCaseManaged = isPathManaged('workspace.useCase', row.managedFieldPaths)
          if (nameManaged && workspaceName !== row.name) {
            throw new Error('Workspace name is managed by your workspace admin')
          }
          if (
            useCaseManaged &&
            ((data.useCase && data.useCase !== current.useCase) ||
              (data.goals &&
                JSON.stringify(goals) !== JSON.stringify(current.goals ?? [current.useCase])) ||
              (data.feedbackPrivate !== undefined &&
                feedbackPrivate !== (current.feedbackPrivate ?? false)))
          ) {
            throw new Error('Workspace goal is managed by your workspace admin')
          }
          const goal = useCaseManaged ? (current.useCase ?? useCase) : useCase
          const selectedGoals = useCaseManaged ? (current.goals ?? [goal]) : goals
          const privateFeedback = useCaseManaged ? current.feedbackPrivate : feedbackPrivate
          const { flags, enabledModules } = flagsForGoals(
            resolveFeatureFlags(row.featureFlags),
            selectedGoals
          )
          const updatePayload: Record<string, unknown> = {
            portalConfig: row.portalConfig ?? JSON.stringify(DEFAULT_PORTAL_CONFIG),
            authConfig:
              row.authConfig ?? JSON.stringify({ ...DEFAULT_AUTH_CONFIG, openSignup: true }),
            featureFlags: JSON.stringify(flags),
          }
          if (!nameManaged) updatePayload.name = workspaceName
          if (!slugManaged) updatePayload.slug = slug
          const [updated] = await tx
            .update(settings)
            .set(updatePayload)
            .where(eq(settings.id, row.id))
            .returning()
          const next = finishIdentityOnboarding(
            { ...current, goals: selectedGoals, feedbackPrivate: privateFeedback },
            goal
          )
          await prepareOnboardingBoard(tx, next)
          return {
            state: next,
            value: {
              updated,
              goal,
              managed: { name: nameManaged, slug: slugManaged, useCase: useCaseManaged },
              enabledModules,
            },
          }
        })
        result = {
          id: value.updated.id,
          name: value.updated.name,
          slug: value.updated.slug,
          useCase: value.goal,
          managed: value.managed,
          enabledModules: value.enabledModules,
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
    }
  )

/** Stamp default outcome, friendly-host details, and handoff so Home can open. */
export const ensureOnboardingHomeReadyFn = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await getSession()
  if (!session?.user) return { ok: false as const, modulesChanged: false }
  if (session.session.scope !== 'dashboard') return { ok: false as const, modulesChanged: false }
  const existingSettings = await getSettings()
  if (!existingSettings) return { ok: false as const, modulesChanged: false }
  const caller = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
  })
  if (!caller || !isAdmin(caller.role)) return { ok: false as const, modulesChanged: false }

  const identity = parseIdentityProjection(existingSettings.cloudIdentity)
  const { friendlyPlatformLabel } = await import('@/lib/shared/platform-label')
  const hasFriendlyHost = Boolean(friendlyPlatformLabel(identity?.platformHostname))

  const { value } = await mutateSetupStateAtomic(async (current, row, tx) => {
    const now = new Date().toISOString()
    const goals = setupGoals(current)
    let next: SetupState = { ...current, goals }
    let modulesChanged = false
    if (hasFriendlyHost && !current.workspaceDetailsSeenAt) {
      next = { ...next, workspaceDetailsSeenAt: now }
    }
    if (!next.steps.startingPoint || next.steps.startingPoint.source === 'managed') {
      ;({ modulesChanged } = await applyOnboardingGoals(tx, row, next))
      next = applyDeferredLaunchStartingPoint(next, goals[0], now)
    }
    const firstLanding = !next.activationHandoffSeenAt
    if (firstLanding) {
      next = { ...next, activationHandoffSeenAt: now }
    }
    return { state: next, value: { modulesChanged, firstLanding } }
  })
  // The owner's first landing queues the welcome and the day-two nudge.
  if (value.firstLanding) {
    const { scheduleOnboardingEmails } =
      await import('@/lib/server/domains/onboarding/onboarding-emails')
    await scheduleOnboardingEmails(caller.id as PrincipalId).catch((error) =>
      log.warn({ err: error }, 'onboarding emails not scheduled')
    )
  }
  return { ok: true as const, modulesChanged: value.modulesChanged }
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
    const session = await getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }
    if (toSessionScope(session.session?.scope) !== 'dashboard') {
      throw new Error('Only admin can change setup')
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
  })
