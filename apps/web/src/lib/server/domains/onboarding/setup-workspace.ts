import type { UserId, PostStatusId, PrincipalId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { DEFAULT_SETUP_STATE, type OnboardingOutcome, type SetupState } from '@/lib/server/db'
import { isAdmin } from '@/lib/shared/roles'
import { getSettings } from '@/lib/server/functions/workspace'
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
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import {
  DEFAULT_AUTH_CONFIG,
  newWorkspaceBaseFlags,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  flagsForGoals,
  resolveFeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { workspaceSlugFor } from '@/lib/server/domains/settings/workspace-slug'
import { logger } from '@/lib/server/logger'
import { LockedError } from '@/lib/shared/errors'
import { finishIdentityOnboarding, mutateSetupStateAtomic } from '@/lib/server/setup-state'
import { applyOnboardingGoals } from '@/lib/server/onboarding-board'
import type { SupportedLocale } from '@/lib/shared/i18n'

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

export function refuse(refusal: SaveWorkspaceRefusal): {
  ok: false
  refusal: SaveWorkspaceRefusal
} {
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
export async function ensureBootstrapAdmin(
  userId: UserId,
  options: { operatorAuthorized?: boolean } = {}
): Promise<SaveWorkspaceRefusal | null> {
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
    // An operator holding the setup token has the install's own say in who the
    // owner is, so it overrides whichever account arrived first.
    if (!options.operatorAuthorized && claimant && claimant.userId !== userId) {
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

/** What the workspace step collects. The server function validates it before calling. */
export interface SaveWorkspaceInput {
  workspaceName: string
  userName?: string
  useCase?: OnboardingOutcome
  goals?: OnboardingOutcome[]
  feedbackPrivate?: boolean
}

/**
 * Claims the workspace for `userId` and finishes setup: promotes the first
 * admin (see {@link ensureBootstrapAdmin}), creates or completes the settings
 * row, and seeds the default statuses. The one implementation behind both the
 * browser's workspace step and the operator's headless setup request.
 *
 * `operatorAuthorized` is set only by a caller that has already proved it holds
 * the install's setup token.
 */
export async function setupWorkspaceForUser(input: {
  userId: UserId
  data: SaveWorkspaceInput
  locale: SupportedLocale | undefined
  operatorAuthorized?: boolean
}): Promise<SaveWorkspaceAndGoalResponse> {
  const { userId, locale, data } = input
  const workspaceName = data.workspaceName
  const slug = workspaceSlugFor(workspaceName)
  const goals = [...new Set(data.goals ?? [data.useCase ?? 'product_feedback'])]
  const useCase = goals[0]

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
      where: eq(principal.userId, userId),
    })
    if (!principalRecord || !isAdmin(principalRecord.role)) return refuse('not_owner')
  } else {
    const refusal = await ensureBootstrapAdmin(userId, {
      operatorAuthorized: input.operatorAuthorized,
    })
    if (refusal) return refuse(refusal)
  }
  // Whoever sets the workspace up is its owner, recorded once.
  const setupBy = await db.query.principal.findFirst({
    where: eq(principal.userId, userId),
    columns: { id: true },
  })

  let result: SaveWorkspaceAndGoalResult
  // Finishing setup stamps the activation handoff, which is also what
  // Home's first landing waits for before it queues the welcome emails.
  // So the save that makes the first stamp queues them, in the same
  // transaction: a stamp that committed without its jobs would never be
  // retried, because every later pass sees the handoff already made.
  const { scheduleOnboardingEmails } =
    await import('@/lib/server/domains/onboarding/onboarding-emails')
  if (!existingSettings) {
    // Setup no longer offers a private board: a new workspace's board is public.
    const initialState: SetupState = finishIdentityOnboarding(
      {
        ...DEFAULT_SETUP_STATE,
        goals,
        ...(setupBy && { ownerPrincipalId: setupBy.id }),
        steps: { ...DEFAULT_SETUP_STATE.steps, workspace: true },
      },
      useCase
    )
    const baseFlags = newWorkspaceBaseFlags(goals)
    const { enabledModules } = flagsForGoals(baseFlags, goals)
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
            featureFlags: JSON.stringify(baseFlags),
          })
          .returning()
        if (!row) throw new Error('Failed to create workspace settings')
        // The goals' modules turn on through the one flag write, with what
        // turning each on does (publishing the status page, for one).
        await applyOnboardingGoals(tx, row, initialState)
        if (setupBy) {
          await scheduleOnboardingEmails(setupBy.id as PrincipalId, new Date(), locale, tx)
        }
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
        throw new LockedError('FIELD_LOCKED', 'Workspace name is managed by your workspace admin')
      }
      if (
        useCaseManaged &&
        ((data.useCase && data.useCase !== current.useCase) ||
          (data.goals &&
            JSON.stringify(goals) !== JSON.stringify(current.goals ?? [current.useCase])) ||
          (data.feedbackPrivate !== undefined &&
            data.feedbackPrivate !== (current.feedbackPrivate ?? false)))
      ) {
        throw new LockedError('FIELD_LOCKED', 'Workspace goal is managed by your workspace admin')
      }
      const goal = useCaseManaged ? (current.useCase ?? useCase) : useCase
      const selectedGoals = useCaseManaged ? (current.goals ?? [goal]) : goals
      // Setup no longer offers a private board; a workspace that chose one
      // before keeps it.
      const privateFeedback = current.feedbackPrivate
      const { enabledModules } = flagsForGoals(resolveFeatureFlags(row.featureFlags), selectedGoals)
      const updatePayload: Record<string, unknown> = {
        portalConfig: row.portalConfig ?? JSON.stringify(DEFAULT_PORTAL_CONFIG),
        authConfig: row.authConfig ?? JSON.stringify({ ...DEFAULT_AUTH_CONFIG, openSignup: true }),
      }
      if (!nameManaged) updatePayload.name = workspaceName
      if (!slugManaged) updatePayload.slug = slug
      const [updated] = await tx
        .update(settings)
        .set(updatePayload)
        .where(eq(settings.id, row.id))
        .returning()
      const ownerPrincipalId = current.ownerPrincipalId ?? setupBy?.id
      const next = finishIdentityOnboarding(
        {
          ...current,
          goals: selectedGoals,
          feedbackPrivate: privateFeedback,
          ...(ownerPrincipalId && { ownerPrincipalId }),
        },
        goal
      )
      await applyOnboardingGoals(tx, updated!, next)
      if (!current.activationHandoffSeenAt && ownerPrincipalId) {
        await scheduleOnboardingEmails(ownerPrincipalId as PrincipalId, new Date(), locale, tx)
      }
      return {
        state: next,
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
      .where(eq(user.id, userId))
    await syncPrincipalProfile(userId, { displayName: data.userName })
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

  // The first admin exists now, so a generated setup token has nothing left to open.
  const { clearGeneratedToken } = await import('@/lib/server/domains/onboarding/setup-token-store')
  await clearGeneratedToken()

  log.info({ workspace_id: result.id, slug: result.slug }, 'save workspace and goal complete')
  return { ok: true, ...result }
}
