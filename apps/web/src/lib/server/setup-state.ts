import {
  DEFAULT_SETUP_STATE,
  db,
  eq,
  getSetupState,
  normalizeSetupStateV2,
  settings,
  type OnboardingOutcome,
  type SetupState,
  type Transaction,
} from '@/lib/server/db'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'

type SettingsRow = typeof settings.$inferSelect

export interface SetupStateMutation<T> {
  state: SetupState
  value: T
}

/**
 * The only update boundary for settings.setup_state.
 *
 * The settings row is locked before parsing so concurrent goal, checklist,
 * onboarding-resource, and config reconciliation writes always start from the
 * latest committed JSON. The callback may perform related writes through the
 * same transaction; its returned V2 state is persisted before commit. Legacy
 * JSON is normalized on entry and therefore migrates lazily on this write.
 */
export async function mutateSetupStateAtomic<T>(
  mutate: (
    current: SetupState,
    row: SettingsRow,
    tx: Transaction
  ) => Promise<SetupStateMutation<T>> | SetupStateMutation<T>
): Promise<SetupStateMutation<T>> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).limit(1).for('update')
    if (!row) throw new Error('Workspace is not set up yet')

    const current = getSetupState(row.setupState) ?? DEFAULT_SETUP_STATE
    const next = await mutate(current, row, tx)
    const normalized = normalizeSetupStateV2(next.state)
    if (!normalized) throw new Error('Setup state mutation produced invalid state')

    await tx
      .update(settings)
      .set({ setupState: JSON.stringify(normalized) })
      .where(eq(settings.id, row.id))

    return { state: normalized, value: next.value }
  })

  await invalidateSettingsCache()
  return result
}

/**
 * Finish the short wizard without creating a starter artifact. The use-case
 * launch list owns that work, so the owner should land there — not on a
 * second "create a board" confirmation.
 */
export function applyDeferredLaunchStartingPoint(
  current: SetupState,
  outcome: OnboardingOutcome,
  now = new Date().toISOString()
): SetupState {
  const existing = current.steps.startingPoint
  if (existing && existing.source !== 'managed') {
    return {
      ...current,
      steps: { ...current.steps, workspace: true },
      useCase: outcome,
    }
  }
  return {
    ...current,
    steps: {
      ...current.steps,
      workspace: true,
      startingPoint: {
        outcome,
        resourceType: 'none',
        source: 'wizard',
        resolution: 'deferred',
        completedAt: now,
      },
    },
    useCase: outcome,
    completedAt: current.completedAt ?? now,
    completionSource:
      current.completionSource === 'managed' ? 'wizard' : (current.completionSource ?? 'wizard'),
  }
}

/** Mark the activation handoff as acknowledged without disturbing other state. */
export async function acknowledgeActivationHandoff(): Promise<SetupState> {
  const { state } = await mutateSetupStateAtomic((current) => ({
    state: current.activationHandoffSeenAt
      ? current
      : { ...current, activationHandoffSeenAt: new Date().toISOString() },
    value: undefined,
  }))
  return state
}
