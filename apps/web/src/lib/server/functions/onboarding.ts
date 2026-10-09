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
  findSetupClaimant,
  isOpenToBootstrapClaim,
  isSetupOpenToClaim,
  isSetupStateOpen,
} from '@/lib/server/domains/principals/bootstrap-admin'
import { db, settings, principal, user, postStatuses, eq, DEFAULT_STATUSES } from '@/lib/server/db'
import { isOnboardingComplete } from '@/lib/shared/db-types'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  flagsForGoal,
  resolveFeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { workspaceSlugFor } from '@/lib/server/domains/settings/workspace-slug'
import { getSetupState } from '@/lib/shared/db-types'
import { logger } from '@/lib/server/logger'
import {
  applyDeferredLaunchStartingPoint,
  finishIdentityOnboarding,
  mutateSetupStateAtomic,
} from '@/lib/server/setup-state'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'

const log = logger.child({ component: 'onboarding' })

/**
 * Why the workspace step refused a save. Each one has its own next step in the
 * browser, so they are returned rather than thrown: an error thrown from a
 * server function does not reliably reach the client with anything it can
 * branch on.
 *
 * - `signed_out`: no session that can set a workspace up. Sign in and finish.
 * - `not_owner`: setup is somebody else's, or not decided by arriving here.
 * - `setup_complete`: setup is finished. The name and goal live in Settings.
 */
export type SaveWorkspaceRefusal = 'signed_out' | 'not_owner' | 'setup_complete'

function refuse(refusal: SaveWorkspaceRefusal): { ok: false; refusal: SaveWorkspaceRefusal } {
  return { ok: false, refusal }
}

/** Thrown inside a settings write to roll it back when setup finished first. */
class SetupFinishedMeanwhile extends Error {}

/** Turns {@link SetupFinishedMeanwhile} into "nothing written"; rethrows the rest. */
function finishedMeanwhile(err: unknown): null {
  if (err instanceof SetupFinishedMeanwhile) {
    log.info('workspace save refused: setup finished while it was in flight')
    return null
  }
  throw err
}

/**
 * The one place a workspace's first admin is created, and the one place the
 * workspace step's authorization is decided. Five answers, in order: an admin
 * caller passes, a caller who is not the existing owner is refused, a caller on
 * a workspace that is not open to be claimed is refused, a caller who is not
 * the account that claimed setup is refused, and the claimant (or, where
 * nobody has an account yet, the caller) on an install nobody provisioned is
 * promoted.
 *
 * Reached only from the workspace step, where the caller has explicitly asked
 * to set this workspace up. Nothing that merely reports state may promote:
 * a loader runs on every page load, so a promoting reporter hands admin to
 * whoever loads the page first.
 *
 * Resolves to null once the caller holds admin, or to the refusal.
 */
async function ensureBootstrapAdmin(userId: UserId): Promise<SaveWorkspaceRefusal | null> {
  return db.transaction(async (tx) => {
    // Serialize the one-time bootstrap decision so two first users cannot both
    // observe an empty admin set and promote themselves concurrently.
    await tx.execute(bootstrapAdminLock())

    const caller = await tx.query.principal.findFirst({
      where: eq(principal.userId, userId),
    })
    if (caller && isAdmin(caller.role)) return null
    // Only a person owns setup; an anonymous visitor's principal never does.
    if (caller && caller.type !== 'user') return 'not_owner'

    // Bootstrap promotion is only valid until the first human admin exists.
    const existingAdmin = await findHumanAdmin(tx)
    if (existingAdmin) {
      log.warn({ user_id: userId }, 'bootstrap admin promotion refused: setup is already claimed')
      return 'not_owner'
    }

    // Nobody owns it — which on a provisioned workspace is a statement about
    // the owner not having arrived yet, not an invitation to become them.
    // Asked on `tx` so it is decided inside the same lock window as the two
    // questions above rather than alongside them.
    if (!(await isOpenToBootstrapClaim(tx))) {
      log.warn({ user_id: userId }, 'bootstrap admin promotion refused: workspace is provisioned')
      return 'not_owner'
    }

    // A finished workspace with no human admin left is not unclaimed setup.
    // Claiming is how setup gets finished, so once it is finished nobody
    // claims it by arriving, however its admins came to be gone.
    if (!(await isSetupOpenToClaim(tx))) {
      log.warn({ user_id: userId }, 'bootstrap admin promotion refused: setup is complete')
      return 'setup_complete'
    }

    // On an install still being set up, the first account created there owns
    // setup, or the account at the address the operator named. Anyone else who
    // reaches this step, however they came to have an account, is refused, so
    // the claimant can sign out and come back without losing the install to
    // whoever arrived in between.
    const claimant = await findSetupClaimant(tx)
    if (claimant && claimant.userId !== userId) {
      log.warn(
        { user_id: userId, owner_named: claimant.ownerEmail !== null },
        'bootstrap admin promotion refused: another account claimed setup'
      )
      return 'not_owner'
    }

    const { created, principal: p } = await ensurePrincipalForUser({ userId, role: 'admin' }, tx)
    if (!created && !isAdmin(p.role)) {
      await setPrincipalRole({ userId }, 'admin', { executor: tx, knownUserId: userId })
    }
    // Both branches hand out the same authority, so both are worth the same
    // line in the log: this is the only record that a workspace was claimed.
    log.info({ user_id: userId, created }, 'bootstrap admin promotion')
    return null
  })
}

/**
 * Server functions for onboarding workflow.
 */

/** Whether somebody already owns this workspace's setup. */
export interface WorkspaceClaim {
  /**
   * A human admin owns setup, or, on an install still being set up, an
   * account has been created and so has claimed it. Either way this screen
   * offers sign-in rather than a new account. Where the operator named the
   * owner, only that address's account claims it, so until it exists this
   * reads false and the owner can create it.
   */
  claimed: boolean
  /**
   * Whether the workspace's own pages are reachable yet. Until setup
   * finishes, the root gate returns the portal root to the wizard, so the
   * claim screen can only offer a way out once this is true.
   */
  setupComplete: boolean
  /**
   * Whether this workspace's setup is decided here at all: true on an install
   * nobody provisioned whose setup is still open, where arriving is how setup
   * is claimed, and {@link claimed} says whether anyone has.
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
 * owner is a principal that is a human (`type: 'user'`) and an admin, a
 * workspace is open to be claimed only when no control plane created it, and
 * on an install still being set up the first account created claims it. A
 * workspace that arrives with an owner already seeded reads `claimed: true` and
 * its first screen offers sign-in; a provisioned one whose owner has not
 * arrived reads `openToClaim: false` and offers sign-in too, because there is
 * no account for a stranger to create here; an install that starts empty reads
 * `claimed: false` with `openToClaim: true` and keeps the account-creation form
 * it has always had, until its first account exists and it reads `claimed:
 * true`, which sends the person who created it (and anyone else) to sign-in.
 *
 * Deliberately unauthenticated, because the visitor it exists for has no
 * session yet. It answers one question about the workspace as a whole and
 * never about any person, so it is not an account-presence oracle: the answer
 * is identical for every visitor.
 *
 * It deliberately says nothing about WHO the owner or claimant is, nor whether
 * the claimant holds admin yet. Everything a loader returns is dehydrated into
 * the SSR document, so an owner hint would be a single unauthenticated GET away
 * for anyone who can guess the hostname, and the local part plus the whole
 * corporate domain is a working target at the moment that person is expecting
 * setup mail. The same rule already governs {@link checkOnboardingState} and
 * the auth-method lookup.
 */
export const getWorkspaceClaimFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WorkspaceClaim> => {
    // Existence only, on the same predicates the promoter guards with, so the
    // screen and the promoter can never disagree about who owns setup or about
    // whether it is still there to be taken.
    const [owner, claimant, unprovisioned, setupOpen] = await Promise.all([
      findHumanAdmin(db),
      findSetupClaimant(db),
      isOpenToBootstrapClaim(db),
      isSetupOpenToClaim(db),
    ])

    const current = await getSettings()
    const setupComplete = isOnboardingComplete(getSetupState(current?.setupState ?? null))

    // Same order the promoter refuses in: provenance first, then setup state.
    const closedReason = !unprovisioned ? 'provisioned' : !setupOpen ? 'setupComplete' : null
    return {
      claimed: !!owner || !!claimant?.userId,
      setupComplete,
      openToClaim: closedReason === null,
      closedReason,
    }
  }
)

// ============================================
// Schemas
// ============================================

// Trimmed before the length checks, so a name of spaces is refused rather
// than saved empty.
const saveWorkspaceAndGoalSchema = z.object({
  workspaceName: z
    .string()
    .trim()
    .min(2, 'Workspace name must be at least 2 characters')
    .max(100, 'Workspace name must be 100 characters or less'),
  userName: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be 100 characters or less')
    .optional(),
  useCase: z.enum(ONBOARDING_OUTCOMES).optional(),
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

export type SaveWorkspaceAndGoalResponse =
  ({ ok: true } & SaveWorkspaceAndGoalResult) | { ok: false; refusal: SaveWorkspaceRefusal }

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
    async ({
      data,
    }: {
      data: SaveWorkspaceAndGoalInput
    }): Promise<SaveWorkspaceAndGoalResponse> => {
      log.debug(
        { workspace_name: data.workspaceName, use_case: data.useCase ?? 'product_feedback' },
        'save workspace and goal'
      )
      const session = await getSession()
      if (!session?.user || session.session.scope !== 'dashboard') return refuse('signed_out')

      const workspaceName = data.workspaceName
      const slug = workspaceSlugFor(workspaceName)
      const useCase = data.useCase ?? 'product_feedback'

      // Setup is final. Once it is finished, the name and goal belong to
      // Settings, and a form left open in another tab must not run setup
      // again. The same question the claim asks, so a workspace the config
      // file stamped complete before its owner arrived is still open here.
      // Asked again under the settings lock below, where it decides.
      if (!(await isSetupOpenToClaim(db))) return refuse('setup_complete')

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
        if (!principalRecord || !isAdmin(principalRecord.role)) return refuse('not_owner')
      } else {
        const refusal = await ensureBootstrapAdmin(session.user.id as UserId)
        if (refusal) return refuse(refusal)
      }

      let result: SaveWorkspaceAndGoalResult
      if (!existingSettings) {
        const initialState: SetupState = finishIdentityOnboarding(
          { ...DEFAULT_SETUP_STATE, steps: { ...DEFAULT_SETUP_STATE.steps, workspace: true } },
          useCase
        )
        const { flags, enabledModules } = flagsForGoal(DEFAULT_FEATURE_FLAGS, useCase)
        const created = await db
          .transaction(async (tx) => {
            // Two saves can both read "no settings yet". The first to take the
            // lock creates the workspace and finishes setup; the second finds
            // that row and stops, rather than writing a second one.
            await tx.execute(bootstrapAdminLock())
            const [already] = await tx.select({ id: settings.id }).from(settings).limit(1)
            if (already) throw new SetupFinishedMeanwhile()
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
            return row
          })
          .catch(finishedMeanwhile)
        if (!created) return refuse('setup_complete')
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
        const mutation = await mutateSetupStateAtomic(async (current, row, tx) => {
          // The decision, under the settings row lock: the early check above
          // can pass while another tab is still finishing setup.
          if (!isSetupStateOpen(current)) throw new SetupFinishedMeanwhile()
          const nameManaged = isPathManaged('workspace.name', row.managedFieldPaths)
          const slugManaged = isPathManaged('workspace.slug', row.managedFieldPaths)
          const useCaseManaged = isPathManaged('workspace.useCase', row.managedFieldPaths)
          if (nameManaged && workspaceName !== row.name) {
            throw new Error('Workspace name is managed by your workspace admin')
          }
          if (useCaseManaged && data.useCase && data.useCase !== current.useCase) {
            throw new Error('Workspace goal is managed by your workspace admin')
          }
          const goal = useCaseManaged ? (current.useCase ?? useCase) : useCase
          const { flags, enabledModules } = flagsForGoal(
            resolveFeatureFlags(row.featureFlags),
            goal
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
          return {
            state: finishIdentityOnboarding(current, goal),
            value: {
              updated,
              goal,
              managed: { name: nameManaged, slug: slugManaged, useCase: useCaseManaged },
              enabledModules,
            },
          }
        }).catch(finishedMeanwhile)
        if (!mutation) return refuse('setup_complete')
        const { value } = mutation
        result = {
          id: value.updated.id,
          name: value.updated.name,
          slug: value.updated.slug,
          useCase: value.goal,
          managed: value.managed,
          enabledModules: value.enabledModules,
        }
      }

      if (data.userName) {
        await db
          .update(user)
          .set({ name: data.userName, updatedAt: new Date() })
          .where(eq(user.id, session.user.id as UserId))
        await syncPrincipalProfile(session.user.id as UserId, { displayName: data.userName })
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
      return { ok: true, ...result }
    }
  )

const saveCloudOnboardingGoalSchema = z.object({ useCase: z.enum(ONBOARDING_OUTCOMES) }).strict()

/** Save only the outcome for a control-plane-provisioned workspace. */
export const saveCloudOnboardingGoalFn = createServerFn({ method: 'POST' })
  .validator(saveCloudOnboardingGoalSchema)
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session?.user) throw new Error('Authentication required')
    if (session.session.scope !== 'dashboard') throw new Error('Only admin can change setup')
    const caller = await db.query.principal.findFirst({
      where: eq(principal.userId, session.user.id as UserId),
    })
    if (!caller || !isAdmin(caller.role)) throw new Error('Only admin can change setup')

    const { state, value } = await mutateSetupStateAtomic(async (current, row, tx) => {
      if (!parseIdentityProjection(row.cloudIdentity)) {
        throw new Error('Cloud workspace identity is not enabled')
      }
      if (!current.workspaceDetailsSeenAt) {
        throw new Error('Set your workspace name and URL first')
      }
      const { flags, enabledModules } = flagsForGoal(
        resolveFeatureFlags(row.featureFlags),
        data.useCase
      )
      await tx
        .update(settings)
        .set({ featureFlags: JSON.stringify(flags) })
        .where(eq(settings.id, row.id))
      return {
        state: applyDeferredLaunchStartingPoint(current, data.useCase),
        value: { enabledModules },
      }
    })

    const existingStatuses = await db.query.postStatuses.findFirst()
    if (!existingStatuses) {
      await db.insert(postStatuses).values(
        DEFAULT_STATUSES.map((status) => ({
          id: generateId('post_status') as PostStatusId,
          ...status,
          createdAt: new Date(),
        }))
      )
    }
    return { useCase: state.useCase!, enabledModules: value.enabledModules }
  })

/** Stamp default outcome, friendly-host details, and handoff so Home can open. */
export const ensureOnboardingHomeReadyFn = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await getSession()
  if (!session?.user) return { ok: false as const }
  if (session.session.scope !== 'dashboard') return { ok: false as const }
  const existingSettings = await getSettings()
  if (!existingSettings) return { ok: false as const }
  const caller = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
  })
  if (!caller || !isAdmin(caller.role)) return { ok: false as const }

  const identity = parseIdentityProjection(existingSettings.cloudIdentity)
  const { friendlyPlatformLabel } = await import('@/lib/shared/platform-label')
  const hasFriendlyHost = Boolean(friendlyPlatformLabel(identity?.platformHostname))

  await mutateSetupStateAtomic(async (current, row, tx) => {
    const now = new Date().toISOString()
    const goal =
      current.useCase && current.useCase !== 'internal' ? current.useCase : 'product_feedback'
    let next = current
    if (hasFriendlyHost && !current.workspaceDetailsSeenAt) {
      next = { ...next, workspaceDetailsSeenAt: now }
    }
    if (!next.steps.startingPoint || next.steps.startingPoint.source === 'managed') {
      const { flags } = flagsForGoal(resolveFeatureFlags(row.featureFlags), goal)
      await tx
        .update(settings)
        .set({ featureFlags: JSON.stringify(flags) })
        .where(eq(settings.id, row.id))
      next = applyDeferredLaunchStartingPoint(next, goal, now)
    }
    if (!next.activationHandoffSeenAt) {
      next = { ...next, activationHandoffSeenAt: now }
    }
    return { state: next, value: undefined }
  })
  return { ok: true as const }
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
