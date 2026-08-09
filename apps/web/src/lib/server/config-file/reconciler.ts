import { computeManagedPaths } from './managed-paths'
import type { QuackbackConfigSpec } from './schema'
import {
  cloudConfigEquivalent,
  mergeCloudConfig,
  type CloudConfigPatch,
} from '@/lib/server/domains/settings/cloud/cloud.merge'
import {
  DEFAULT_SETUP_STATE,
  getSetupState,
  normalizeOnboardingOutcome,
  type SetupState,
  type StoredCloudConfig,
} from '@/lib/shared/db-types'

type ConfigWorkspace = NonNullable<QuackbackConfigSpec['workspace']>

export interface SettingsRow {
  id: string
  name: string
  slug: string
  setupState: string | null
  tierLimits: string | null
  /**
   * Current `settings.cloud` value. Optional so existing callers and test
   * fixtures that predate the cloud block keep compiling; absent and null are
   * treated identically (no cloud config).
   */
  cloud?: StoredCloudConfig | null
  managedFieldPaths: string[]
}

export interface SettingsUpdate {
  name?: string
  slug?: string
  /** Re-applied to the locked, latest setup state by production deps. */
  setupWorkspace?: ConfigWorkspace
  tierLimits?: string
  /** Merged cloud block, written as jsonb (not a JSON string, unlike tierLimits). */
  cloud?: StoredCloudConfig
  managedFieldPaths: string[]
}

/**
 * Shape used to seed a brand-new settings row from a config file when
 * none exists yet. workspace.name + slug are the only required fields
 * (everything else falls back to sensible defaults / null). The
 * production wiring picks the row id from the schema's TypeID default.
 */
export interface SettingsInsert {
  name: string
  slug: string
  setupState?: string
  tierLimits?: string
  cloud?: StoredCloudConfig
  managedFieldPaths: string[]
}

export interface ReconcileDeps {
  readSettings: () => Promise<SettingsRow | null>
  updateSettings: (update: SettingsUpdate) => Promise<void>
  /** Insert a fresh settings row when none exists yet. Called by the
   *  reconciler when the file declares at least workspace.name + slug
   *  (the minimum required for a valid row). With the legacy
   *  seed-workspace path removed, the file is the sole seed channel
   *  when no settings row exists yet. */
  createSettings: (insert: SettingsInsert) => Promise<void>
  invalidateSettingsCache: () => Promise<void>
  invalidateTierLimitsCache: () => Promise<void>
  /** Post-reconcile status reporter. Optional so unit tests don't have
   *  to stub it; production wiring (`makeReconcileDeps`) populates it
   *  with a fetch to the operator's status endpoint. A silent no-op
   *  when its env vars aren't configured. */
  reportStatus?: (status: {
    kind: 'ok' | 'absent' | 'error'
    message?: string
    configHash?: string
  }) => Promise<void>
}

/**
 * Apply a parsed config spec to the settings row.
 *
 * Idempotent: when the resulting update would be a no-op (every
 * targeted field already matches), `updateSettings` is skipped. Cache
 * invalidations only fire when something actually changed.
 */
export async function reconcileFileIntoDb(
  spec: QuackbackConfigSpec,
  deps: ReconcileDeps
): Promise<void> {
  const current = await deps.readSettings()
  if (!current) {
    // No settings row exists yet. With seed-workspace.ts retired, the
    // file watcher is the sole seed channel for a fresh install.
    // Bootstrap requires at least workspace.name + slug; without those
    // we can't satisfy the NOT NULL columns, so wait for a richer file.
    if (!spec.workspace?.name || !spec.workspace?.slug) return

    const setupState = JSON.stringify(mergeSetupState(null, spec.workspace))
    await deps.createSettings({
      name: spec.workspace.name,
      slug: spec.workspace.slug,
      setupState,
      tierLimits: spec.tierLimits !== undefined ? JSON.stringify(spec.tierLimits) : undefined,
      cloud:
        spec.cloud !== undefined
          ? mergeCloudConfig(null, toCloudPatch(spec.cloud), { writer: 'config' })
          : undefined,
      managedFieldPaths: computeManagedPaths(spec),
    })
    await deps.invalidateSettingsCache()
    await deps.invalidateTierLimitsCache()
    return
  }

  const newPaths = computeManagedPaths(spec)
  const update: SettingsUpdate = { managedFieldPaths: newPaths }

  if (spec.workspace?.name !== undefined && spec.workspace.name !== current.name) {
    update.name = spec.workspace.name
  }
  if (spec.workspace?.slug !== undefined && spec.workspace.slug !== current.slug) {
    update.slug = spec.workspace.slug
  }

  if (spec.workspace !== undefined) {
    const setup = mergeSetupState(current.setupState, spec.workspace)
    const serialized = JSON.stringify(setup)
    if (serialized !== current.setupState) update.setupWorkspace = spec.workspace
  }

  if (spec.tierLimits !== undefined) {
    const serialized = JSON.stringify(spec.tierLimits)
    if (serialized !== current.tierLimits) update.tierLimits = serialized
  }

  if (spec.cloud !== undefined) {
    // Merged, not replaced: the file owns only what it declares, so a billing
    // reference written by the other writer survives a reconcile that names
    // just a plan. `cloudConfigEquivalent` ignores the write stamp so a
    // steady-state file does not rewrite the row on every 30-second tick.
    const merged = mergeCloudConfig(current.cloud ?? null, toCloudPatch(spec.cloud), {
      writer: 'config',
    })
    if (!cloudConfigEquivalent(merged, current.cloud ?? null)) update.cloud = merged
  }

  const pathsChanged = !arrayEquals(newPaths, current.managedFieldPaths)
  const hasFieldUpdates = Object.keys(update).length > 1 // > 1 because managedFieldPaths is always set

  if (!pathsChanged && !hasFieldUpdates) {
    return
  }

  await deps.updateSettings(update)
  await deps.invalidateSettingsCache()
  await deps.invalidateTierLimitsCache()
}

/**
 * Config-file cloud block -> write patch. The two shapes are deliberately
 * near-identical; this exists so the file's `undefined` (not declared, leave
 * alone) survives into the merge rather than being flattened to a null.
 */
function toCloudPatch(cloud: NonNullable<QuackbackConfigSpec['cloud']>): CloudConfigPatch {
  const patch: CloudConfigPatch = { enabled: cloud.enabled }
  if (cloud.plan !== undefined) patch.plan = cloud.plan
  if (cloud.entitlements !== undefined) patch.entitlements = cloud.entitlements
  if (cloud.billing !== undefined) patch.billing = cloud.billing
  if (cloud.upgradeUrl !== undefined) patch.upgradeUrl = cloud.upgradeUrl
  return patch
}

export function mergeSetupState(
  existing: string | SetupState | null,
  workspace: ConfigWorkspace
): SetupState {
  const parsed =
    typeof existing === 'string'
      ? (getSetupState(existing) ?? DEFAULT_SETUP_STATE)
      : (existing ?? DEFAULT_SETUP_STATE)
  // Workspace step is "done" when either name or slug ships in the
  // file. Slug-only declarations need this so the wizard advances when
  // only the slug is managed.
  const fileSetsWorkspace = workspace.name !== undefined || workspace.slug !== undefined
  const forceComplete = workspace.onboardingComplete === true
  // Stamp completedAt on the FIRST reconcile that flips the flag on,
  // then preserve it. Re-stamping on every reconcile would churn the
  // serialized JSON and defeat the no-op detection in
  // reconcileFileIntoDb (every reapply would touch the DB).
  const completedAt = forceComplete
    ? (parsed.completedAt ?? new Date().toISOString())
    : parsed.completedAt
  const outcome = normalizeOnboardingOutcome(workspace.useCase) ?? parsed.useCase
  const startingPoint = forceComplete
    ? (parsed.steps.startingPoint ?? {
        outcome: outcome ?? 'product_feedback',
        resourceType: 'none' as const,
        source: 'managed' as const,
        resolution: 'configured' as const,
        completedAt: completedAt!,
      })
    : parsed.steps.startingPoint
  return {
    version: 2,
    steps: {
      core: forceComplete ? true : parsed.steps.core,
      workspace: forceComplete || fileSetsWorkspace ? true : parsed.steps.workspace,
      startingPoint,
    },
    ...(outcome ? { useCase: outcome } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(forceComplete
      ? { completionSource: parsed.completionSource ?? ('managed' as const) }
      : parsed.completionSource
        ? { completionSource: parsed.completionSource }
        : {}),
    ...(parsed.activationHandoffSeenAt
      ? { activationHandoffSeenAt: parsed.activationHandoffSeenAt }
      : {}),
    ...(parsed.taskResolutions ? { taskResolutions: parsed.taskResolutions } : {}),
  }
}

function arrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  for (let i = 0; i < sortedA.length; i++) if (sortedA[i] !== sortedB[i]) return false
  return true
}
