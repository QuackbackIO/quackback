import { boards, eq, isNull, type SetupState, type Transaction } from '@/lib/server/db'
import { accessForPreset } from '@/lib/shared/schemas/boards'

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
