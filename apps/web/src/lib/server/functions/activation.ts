import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { BoardId, KbArticleId } from '@quackback/ids'
import {
  ONBOARDING_OUTCOMES,
  db,
  and,
  boards,
  count,
  eq,
  getSetupState,
  helpCenterArticles,
  helpCenterCategories,
  isNull,
  settings,
  sql,
  type OnboardingOutcome,
  type SetupState,
  type StartingPointState,
} from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  mutateSetupStateAtomic,
  acknowledgeActivationHandoff,
  applyDeferredLaunchStartingPoint,
} from '@/lib/server/setup-state'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import {
  DEFAULT_MESSENGER_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  enableFlagsForUseCase,
  newlyEnabledProductLabels,
  resolveFeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { parseJsonConfig } from '@/lib/server/domains/settings/settings.helpers'
import { accessForPreset } from '@/lib/shared/schemas/boards'
import { logger } from '@/lib/server/logger'
import { emitPlgEvent } from '@/lib/server/plg-events'

const log = logger.child({ component: 'activation' })

const outcomeSchema = z.enum(ONBOARDING_OUTCOMES)
const completeStartingPointSchema = z.object({ action: z.enum(['complete', 'defer']) })
const markPublicBoardLinkCopiedSchema = z.object({ boardId: z.string().min(1) })

const PRIMARY_TASK: Record<OnboardingOutcome, string> = {
  product_feedback: 'create-board',
  customer_support: 'connect-messenger',
  help_center: 'help-article',
  internal: 'create-board',
}

function withTaskResolution(
  state: SetupState,
  outcome: OnboardingOutcome,
  resolution: 'deferred' | null,
  resolvedAt: string
): SetupState['taskResolutions'] {
  const all = { ...(state.taskResolutions ?? {}) }
  const outcomeTasks = { ...(all[outcome] ?? {}) }
  const taskId = PRIMARY_TASK[outcome]
  if (resolution) outcomeTasks[taskId] = { resolution, resolvedAt }
  else delete outcomeTasks[taskId]
  if (Object.keys(outcomeTasks).length > 0) all[outcome] = outcomeTasks
  else delete all[outcome]
  return Object.keys(all).length > 0 ? all : undefined
}

async function boardCapacity() {
  const [limits, [row]] = await Promise.all([
    getTierLimits(),
    db.select({ count: count() }).from(boards).where(isNull(boards.deletedAt)),
  ])
  const existingCount = Number(row?.count ?? 0)
  return {
    maxBoards: limits.maxBoards,
    existingCount,
    remaining: limits.maxBoards == null ? null : Math.max(0, limits.maxBoards - existingCount),
  }
}

export const getStartingPointContextFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const [row, capacity] = await Promise.all([db.query.settings.findFirst(), boardCapacity()])
  if (!row) throw new Error('Workspace is not set up yet')
  const { getSetupState } = await import('@/lib/shared/db-types')
  const state = getSetupState(row.setupState)
  const outcome = state?.useCase
  if (!outcome) throw new Error('Choose a workspace goal first')
  const flags = resolveFeatureFlags(row.featureFlags)
  const slug = outcome === 'internal' ? 'team-feedback' : 'feedback'
  const preferredBoard = await db.query.boards.findFirst({
    where: and(eq(boards.slug, slug), isNull(boards.deletedAt)),
    columns: { id: true, name: true },
  })
  const existingBoard =
    preferredBoard ??
    (outcome === 'product_feedback' || outcome === 'internal'
      ? await db.query.boards.findFirst({
          where: and(
            isNull(boards.deletedAt),
            outcome === 'internal'
              ? sql`${boards.access}->>'view' = 'team'`
              : sql`coalesce(${boards.access}->>'view', 'anonymous') <> 'team'`
          ),
          columns: { id: true, name: true },
        })
      : null)
  const available =
    outcome === 'customer_support'
      ? flags.supportInbox
      : outcome === 'help_center'
        ? flags.helpCenter
        : Boolean(existingBoard) || capacity.remaining === null || capacity.remaining > 0
  const blockedReason = available
    ? null
    : outcome === 'customer_support'
      ? 'Customer support is turned off for this workspace. Ask a workspace admin to enable it.'
      : outcome === 'help_center'
        ? 'Help Center is turned off for this workspace. Ask a workspace admin to enable it.'
        : "You've reached the board limit for your plan. Remove a board or upgrade to continue."

  return {
    outcome,
    available,
    blockedReason,
    goalManaged: isPathManaged('workspace.useCase', row.managedFieldPaths),
    maxBoards: capacity.maxBoards,
    remainingBoards: capacity.remaining,
    existingBoardName:
      preferredBoard || capacity.remaining === 0 ? (existingBoard?.name ?? null) : null,
    startingPoint: state?.steps.startingPoint ?? null,
  }
})

/** Resolve the exact artifact shown on the one-time setup handoff. */
export const getActivationBridgeContextFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  let row = await db.query.settings.findFirst()
  if (!row) throw new Error('Workspace is not set up yet')
  let state = getSetupState(row.setupState)
  if (
    state?.useCase &&
    (!state.steps.startingPoint || state.steps.startingPoint.source === 'managed')
  ) {
    const { state: next } = await mutateSetupStateAtomic((current) => ({
      state: applyDeferredLaunchStartingPoint(current, current.useCase ?? state!.useCase!),
      value: undefined,
    }))
    state = next
    row = (await db.query.settings.findFirst()) ?? row
  }
  const startingPoint = state?.steps.startingPoint
  if (!startingPoint) throw new Error('Choose a starting point first')

  let resourceLabel: string | null = null
  let starterBoard: { id: string; slug: string; publicPath: string } | null = null
  if (startingPoint.resourceType === 'board' && startingPoint.resourceId) {
    const board = await db.query.boards.findFirst({
      where: and(eq(boards.id, startingPoint.resourceId as BoardId), isNull(boards.deletedAt)),
      columns: { id: true, name: true, slug: true, access: true },
    })
    resourceLabel = board?.name ?? null
    if (board?.access.view === 'anonymous') {
      starterBoard = {
        id: board.id,
        slug: board.slug,
        publicPath: `/?board=${encodeURIComponent(board.slug)}`,
      }
    }
  } else if (startingPoint.resourceType === 'article' && startingPoint.resourceId) {
    const article = await db.query.helpCenterArticles.findFirst({
      where: and(
        eq(helpCenterArticles.id, startingPoint.resourceId as KbArticleId),
        isNull(helpCenterArticles.deletedAt)
      ),
      columns: { title: true },
    })
    resourceLabel = article?.title ?? null
  } else if (startingPoint.resourceType === 'messenger') {
    resourceLabel = `${row.name} Messenger`
  }

  return {
    workspaceName: row.name,
    workspaceSlug: row.slug,
    startingPoint,
    resourceLabel,
    starterBoard,
  }
})

/** Record the first intentional distribution of a publicly viewable board. */
export const markPublicBoardLinkCopiedFn = createServerFn({ method: 'POST' })
  .validator(markPublicBoardLinkCopiedSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })
    const { state, value } = await mutateSetupStateAtomic(async (current, _row, tx) => {
      const board = await tx.query.boards.findFirst({
        where: and(eq(boards.id, data.boardId as BoardId), isNull(boards.deletedAt)),
        columns: { id: true, access: true },
      })
      if (!board) throw new Error('Board not found')
      if (board.access.view !== 'anonymous') {
        throw new Error('Only a publicly viewable board link can be marked as shared')
      }
      const copiedAt =
        current.activationMilestones?.publicBoardLinkCopiedAt ?? new Date().toISOString()
      return {
        state: {
          ...current,
          activationMilestones: {
            ...current.activationMilestones,
            publicBoardLinkCopiedAt: copiedAt,
          },
        },
        value: { boardId: board.id, copiedAt },
      }
    })
    log.info(
      { board_id: value.boardId, copied_at: state.activationMilestones?.publicBoardLinkCopiedAt },
      'public board link copied'
    )
    await emitPlgEvent(
      { name: 'board_link_copied', artifactType: 'board' },
      { workspaceId: auth.settings.id, principalId: auth.principal.id }
    )
    return value
  })

/** Change the activation goal without rewriting or deleting the setup artifact. */
export const setActivationGoalFn = createServerFn({ method: 'POST' })
  .validator(z.object({ outcome: outcomeSchema }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { state, value } = await mutateSetupStateAtomic(async (current, row, tx) => {
      if (isPathManaged('workspace.useCase', row.managedFieldPaths)) {
        throw new Error('Workspace goal is managed by your workspace admin')
      }
      const currentFlags = resolveFeatureFlags(row.featureFlags)
      const nextFlags = enableFlagsForUseCase(currentFlags, data.outcome)
      await tx
        .update(settings)
        .set({ featureFlags: JSON.stringify(nextFlags) })
        .where(eq(settings.id, row.id))
      return {
        state: { ...current, useCase: data.outcome },
        value: { enabledModules: newlyEnabledProductLabels(currentFlags, nextFlags) },
      }
    })
    await emitPlgEvent(
      { name: 'onboarding_goal_saved', outcome: state.useCase! },
      { workspaceId: auth.settings.id, principalId: auth.principal.id }
    )
    return { outcome: state.useCase!, enabledModules: value.enabledModules }
  })

export interface CompleteStartingPointResult {
  startingPoint: StartingPointState
  workspace: { name: string; slug: string }
}

export function shouldStartTrialForStarter(resolution: StartingPointState['resolution']): boolean {
  return resolution === 'created' || resolution === 'configured'
}

/**
 * Create/configure one deterministic starting point and complete the setup
 * wizard in the same row-locked transaction. Retrying returns the same artifact.
 */
export const completeStartingPointFn = createServerFn({ method: 'POST' })
  .validator(completeStartingPointSchema)
  .handler(async ({ data }): Promise<CompleteStartingPointResult> => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const capacity = await boardCapacity()
    const now = new Date().toISOString()

    const { state, value } = await mutateSetupStateAtomic(async (current, row, tx) => {
      const outcome = current.useCase
      if (!outcome || !current.steps.workspace) throw new Error('Complete workspace setup first')

      if (data.action === 'defer') {
        const startingPoint: StartingPointState = {
          outcome,
          resourceType: 'none',
          source: 'wizard',
          resolution: 'deferred',
          completedAt: now,
        }
        const state: SetupState = {
          ...current,
          steps: { ...current.steps, startingPoint },
          completedAt: current.completedAt ?? now,
          completionSource: current.completionSource ?? 'wizard',
          taskResolutions: withTaskResolution(current, outcome, 'deferred', now),
        }
        return {
          state,
          value: {
            startingPoint,
            workspace: { name: row.name, slug: row.slug },
          },
        }
      }

      const flags = resolveFeatureFlags(row.featureFlags)
      let resourceType: StartingPointState['resourceType'] = 'none'
      let resourceId: string | undefined
      let source: StartingPointState['source'] = 'wizard'
      let resolution: StartingPointState['resolution']

      if (outcome === 'customer_support') {
        if (!flags.supportInbox) {
          resolution = 'unavailable'
        } else {
          const widget = parseJsonConfig(row.widgetConfig, DEFAULT_WIDGET_CONFIG)
          await tx
            .update(settings)
            .set({
              widgetConfig: JSON.stringify({
                ...widget,
                enabled: true,
                tabs: { ...widget.tabs, messenger: true },
                messenger: {
                  ...DEFAULT_MESSENGER_CONFIG,
                  ...(widget.messenger ?? {}),
                  enabled: true,
                },
              }),
            })
            .where(eq(settings.id, row.id))
          resourceType = 'messenger'
          resolution = 'configured'
        }
      } else if (outcome === 'help_center') {
        if (!flags.helpCenter) {
          resolution = 'unavailable'
        } else {
          let category = await tx.query.helpCenterCategories.findFirst({
            where: eq(helpCenterCategories.slug, 'getting-started'),
          })
          if (category?.deletedAt) {
            ;[category] = await tx
              .update(helpCenterCategories)
              .set({ deletedAt: null, updatedAt: new Date() })
              .where(eq(helpCenterCategories.id, category.id))
              .returning()
          } else if (!category) {
            ;[category] = await tx
              .insert(helpCenterCategories)
              .values({
                name: 'Getting started',
                slug: 'getting-started',
                description: 'The first answers your customers need.',
                position: 0,
              })
              .returning()
          }

          let article = await tx.query.helpCenterArticles.findFirst({
            where: eq(helpCenterArticles.slug, 'getting-started-with-quackback'),
          })
          if (article?.deletedAt) {
            ;[article] = await tx
              .update(helpCenterArticles)
              .set({ deletedAt: null, categoryId: category.id, updatedAt: new Date() })
              .where(eq(helpCenterArticles.id, article.id))
              .returning()
            source = 'existing'
          } else if (!article) {
            ;[article] = await tx
              .insert(helpCenterArticles)
              .values({
                categoryId: category.id,
                slug: 'getting-started-with-quackback',
                title: `Getting started with ${row.name}`,
                content: 'Write the first answer your customers should find here.',
                principalId: auth.principal.id,
                position: 0,
              })
              .returning()
          } else {
            source = 'existing'
          }
          resourceType = 'article'
          resourceId = article.id
          resolution = source === 'existing' ? 'configured' : 'created'
        }
      } else {
        const internal = outcome === 'internal'
        const slug = internal ? 'team-feedback' : 'feedback'
        let board = await tx.query.boards.findFirst({ where: eq(boards.slug, slug) })
        if (board?.deletedAt) {
          if (capacity.remaining === null || capacity.remaining > 0) {
            ;[board] = await tx
              .update(boards)
              .set({ deletedAt: null, updatedAt: new Date() })
              .where(eq(boards.id, board.id))
              .returning()
            source = 'existing'
          } else {
            board = undefined
          }
        } else if (!board && (capacity.remaining === null || capacity.remaining > 0)) {
          ;[board] = await tx
            .insert(boards)
            .values({
              name: internal ? 'Team feedback' : 'Product feedback',
              slug,
              description: internal
                ? 'A private place for your team to share ideas.'
                : 'A place for customers to submit and vote on ideas.',
              access: accessForPreset(internal ? 'private' : 'public'),
            })
            .returning()
        } else if (board) {
          source = 'existing'
        }
        if (!board) {
          board = await tx.query.boards.findFirst({
            where: and(
              isNull(boards.deletedAt),
              internal
                ? sql`${boards.access}->>'view' = 'team'`
                : sql`coalesce(${boards.access}->>'view', 'anonymous') <> 'team'`
            ),
          })
          if (board) source = 'existing'
        }
        if (board) {
          resourceType = 'board'
          resourceId = board.id
          resolution = source === 'existing' ? 'configured' : 'created'
        } else {
          resolution = 'unavailable'
        }
      }

      const startingPoint: StartingPointState = {
        outcome,
        resourceType,
        ...(resourceId ? { resourceId } : {}),
        source,
        resolution,
        completedAt: now,
      }
      const taskResolutions = withTaskResolution(current, outcome, null, now)
      const state: SetupState = {
        ...current,
        steps: { ...current.steps, startingPoint },
        completedAt: current.completedAt ?? now,
        completionSource: current.completionSource ?? 'wizard',
        ...(taskResolutions ? { taskResolutions } : { taskResolutions: undefined }),
      }
      return {
        state,
        value: {
          startingPoint,
          workspace: { name: row.name, slug: row.slug },
        },
      }
    })

    log.info(
      {
        outcome: value.startingPoint.outcome,
        resolution: value.startingPoint.resolution,
        resource_id: value.startingPoint.resourceId,
      },
      'starting point completed'
    )
    const starterEvent = {
      created: 'starter_created',
      configured: 'starter_configured',
      deferred: 'starter_deferred',
      unavailable: 'starter_unavailable',
    } as const
    await emitPlgEvent(
      {
        name: starterEvent[value.startingPoint.resolution],
        outcome: value.startingPoint.outcome,
        artifactType: value.startingPoint.resourceType,
      },
      { workspaceId: auth.settings.id, principalId: auth.principal.id }
    )

    // The control plane owns trial eligibility and timestamps. Reporting is
    // best effort so a temporary control-plane outage never blocks the user
    // from entering the workspace they just configured. The stamped starter
    // time makes every retry carry the same idempotency key and evidence.
    const { starterTrialEvidence } = await import('@/lib/server/control-plane/starter-trial')
    const evidence = starterTrialEvidence(state)
    if (evidence) {
      try {
        const { reportTrialActivation } = await import('@/lib/server/control-plane/client')
        const status = await reportTrialActivation(evidence)
        if (status === 'started') {
          await emitPlgEvent(
            {
              name: 'trial_started',
              outcome: value.startingPoint.outcome,
              artifactType: evidence.artifactType,
            },
            { workspaceId: auth.settings.id, principalId: auth.principal.id }
          )
        }
      } catch (error) {
        log.error({ err: error }, 'trial activation could not be reported; onboarding continues')
      }
    }

    return value
  })

export const acknowledgeActivationHandoffFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const state = await acknowledgeActivationHandoff()
    return { activationHandoffSeenAt: state.activationHandoffSeenAt! }
  }
)
