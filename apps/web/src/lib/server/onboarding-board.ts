import { boards, eq, isNull, settings, type SetupState, type Transaction } from '@/lib/server/db'
import { flagsForGoals, resolveFeatureFlags } from '@/lib/server/domains/settings/settings.types'
import { accessForPreset } from '@/lib/shared/schemas/boards'

/** The goals a setup state stands for, falling back to its single legacy goal. */
export function setupGoals(state: SetupState): NonNullable<SetupState['goals']> {
  return state.goals?.length ? state.goals : [state.useCase ?? 'product_feedback']
}

/**
 * Apply every chosen goal at the end of setup: turn on each goal's modules
 * (never turning any off) and prepare the feedback board for its audience.
 */
export async function applyOnboardingGoals(
  tx: Transaction,
  row: Pick<typeof settings.$inferSelect, 'id' | 'featureFlags'>,
  state: SetupState
): Promise<{ modulesChanged: boolean }> {
  const before = resolveFeatureFlags(row.featureFlags)
  const { flags } = flagsForGoals(before, setupGoals(state))
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
