import { ForbiddenError, UnauthorizedError } from '@/lib/shared/errors'
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { UserId, PrincipalId } from '@quackback/ids'
import { ONBOARDING_OUTCOMES, type SetupState } from '@/lib/server/db'
import { isAdmin, toSessionScope } from '@/lib/shared/roles'
import { getSession } from '@/lib/server/auth/session'
import { getSettings } from './workspace'
import { syncPrincipalProfile } from '@/lib/server/domains/principals/principal.service'
import {
  findHumanAdmin,
  findSetupClaimant,
  isOpenToBootstrapClaim,
  isSetupOpenToClaim,
} from '@/lib/server/domains/principals/bootstrap-admin'
import { db, principal, user, eq } from '@/lib/server/db'
import { isOnboardingComplete } from '@/lib/shared/db-types'
import { getSetupState } from '@/lib/shared/db-types'
import { logger } from '@/lib/server/logger'
import { applyDeferredLaunchStartingPoint, mutateSetupStateAtomic } from '@/lib/server/setup-state'
import { applyOnboardingGoals, setupGoals } from '@/lib/server/onboarding-board'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'
import type { InstallChecks } from '@/lib/server/install-checks'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  refuse,
  setupWorkspaceForUser,
  type SaveWorkspaceAndGoalResponse,
  type SaveWorkspaceRefusal,
} from '@/lib/server/domains/onboarding/setup-workspace'

export type { SaveWorkspaceRefusal }

const log = logger.child({ component: 'onboarding' })

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
  goals: z.array(z.enum(ONBOARDING_OUTCOMES)).min(1).max(4).optional(),
  feedbackPrivate: z.boolean().optional(),
})

// ============================================
// Type Exports
// ============================================

export type SaveWorkspaceAndGoalInput = z.infer<typeof saveWorkspaceAndGoalSchema>

export type {
  SaveWorkspaceAndGoalResult,
  SaveWorkspaceAndGoalResponse,
} from '@/lib/server/domains/onboarding/setup-workspace'

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

      // Once a human admin owns the workspace, only an admin may run this step.
      // Decided here as well as in the shared implementation, so this entry
      // point's gate is visible where the function is declared.
      if (await findHumanAdmin(db)) {
        const caller = await db.query.principal.findFirst({
          where: eq(principal.userId, session.user.id as UserId),
        })
        if (!caller || !isAdmin(caller.role)) return refuse('not_owner')
      }
      return setupWorkspaceForUser({
        userId: session.user.id as UserId,
        data,
        locale: await requestLocale(),
      })
    }
  )

/** The language this request's browser asked for, or undefined outside a request. */
async function requestLocale() {
  try {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { resolveLocale } = await import('@/lib/shared/i18n')
    return resolveLocale(getRequestHeaders().get('accept-language'))
  } catch {
    return undefined
  }
}

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
      // A provisioned workspace has no setup step; its owner is whoever lands first.
      next = {
        ...next,
        activationHandoffSeenAt: now,
        ownerPrincipalId: next.ownerPrincipalId ?? caller.id,
      }
    }
    return { state: next, value: { modulesChanged, firstLanding } }
  })
  // The owner's first landing queues the welcome and the day-two nudge, in
  // the language their browser asked for unless they choose one later.
  if (value.firstLanding) {
    const { scheduleOnboardingEmails } =
      await import('@/lib/server/domains/onboarding/onboarding-emails')
    const locale = await requestLocale()
    await scheduleOnboardingEmails(caller.id as PrincipalId, new Date(), locale).catch((error) =>
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
      throw new UnauthorizedError('Authentication required')
    }
    if (toSessionScope(session.session?.scope) !== 'dashboard') {
      throw new ForbiddenError('DASHBOARD_SESSION_REQUIRED', 'Only admin can change setup')
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

/**
 * What this install still needs before people outside the admin's browser can
 * use it: email, file storage, and a BASE_URL that names the address in use.
 * Shown once, at the end of setup. Null on a hosted workspace, where the
 * operator is not the admin and nothing here is theirs to change.
 */
export const getInstallChecksFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<InstallChecks | null> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { config } = await import('@/lib/server/config')
    if (config.isPooledTenancy) return null
    const { isEmailConfigured } = await import('@quackback/email')
    const { isS3Usable } = await import('@/lib/server/storage/s3')
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { checkAddress } = await import('@/lib/server/install-checks')
    const headers = getRequestHeaders()
    return {
      email: isEmailConfigured(),
      storage: isS3Usable(),
      address: checkAddress(
        config.baseUrl,
        headers.get('x-forwarded-host') ?? headers.get('host'),
        headers.get('x-forwarded-proto')
      ),
    }
  }
)
