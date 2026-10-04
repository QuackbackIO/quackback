import { boards, eq, isNull, settings, type SetupState, type Transaction } from '@/lib/server/db'
import {
  flagsForGoals,
  resolveFeatureFlags,
  withNewWorkspaceFlags,
} from '@/lib/server/domains/settings/settings.types'
import { LAUNCH_WINDOW_DAYS } from '@/lib/shared/launch-window'
import { accessForPreset } from '@/lib/shared/schemas/boards'

/** The goals a setup state stands for, falling back to its single legacy goal. */
export function setupGoals(state: SetupState): NonNullable<SetupState['goals']> {
  return state.goals?.length ? state.goals : [state.useCase ?? 'product_feedback']
}

/** Created within the launch window of now: a workspace that is still new. */
function isNewWorkspace(createdAt: Date | string | null | undefined, now = Date.now()): boolean {
  const created = createdAt == null ? NaN : new Date(createdAt).getTime()
  return !Number.isNaN(created) && now - created <= LAUNCH_WINDOW_DAYS * 86_400_000
}

/**
 * Apply every chosen goal at the end of setup: turn on each goal's modules
 * (never turning any off) and prepare the feedback board for its audience.
 * A new workspace whose row was created without flags (an operator
 * provisioned it) also gets the flags new workspaces start with; an
 * established workspace never does.
 */
export async function applyOnboardingGoals(
  tx: Transaction,
  row: Pick<typeof settings.$inferSelect, 'id' | 'featureFlags' | 'createdAt'>,
  state: SetupState
): Promise<{ modulesChanged: boolean }> {
  const before = resolveFeatureFlags(row.featureFlags)
  const base = isNewWorkspace(row.createdAt)
    ? withNewWorkspaceFlags(row.featureFlags, before)
    : before
  const { flags } = flagsForGoals(base, setupGoals(state))
  const modulesChanged = JSON.stringify(flags) !== JSON.stringify(before)
  if (modulesChanged) {
    await tx
      .update(settings)
      .set({ featureFlags: JSON.stringify(flags) })
      .where(eq(settings.id, row.id))
  }
  await prepareOnboardingBoard(tx, { ...state, goals: setupGoals(state) })
  return { modulesChanged }
}

/** Seed an empty feedback board with the audience selected during setup. */
export async function prepareOnboardingBoard(tx: Transaction, state: SetupState): Promise<void> {
  if (!(state.goals ?? [state.useCase]).includes('product_feedback')) return
  const existing = await tx.query.boards.findMany({
    where: isNull(boards.deletedAt),
    columns: { id: true, slug: true, access: true },
  })
  const seeded = existing.find((board) => board.slug === 'feedback')
  if (seeded && state.feedbackPrivate && seeded.access.view !== 'team') {
    await tx
      .update(boards)
      .set({ access: accessForPreset('private') })
      .where(eq(boards.id, seeded.id))
  } else if (existing.length === 0) {
    await tx.insert(boards).values({
      name: 'Feedback',
      slug: 'feedback',
      access: accessForPreset(state.feedbackPrivate ? 'private' : 'public'),
    })
  }
}
