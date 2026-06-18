import { computeManagedPaths } from './managed-paths'
import type { QuackbackConfigSpec } from './schema'

export interface SettingsRow {
  id: string
  name: string
  slug: string
  setupState: string | null
  tierLimits: string | null
  featureFlags: string | null
  authConfig: string | null
  managedFieldPaths: string[]
  state: 'active' | 'suspended' | 'deleting' | 'deleted'
}

export interface SettingsUpdate {
  name?: string
  slug?: string
  setupState?: string
  tierLimits?: string
  featureFlags?: string
  authConfig?: string
  managedFieldPaths: string[]
  state?: 'active' | 'suspended' | 'deleting' | 'deleted'
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
  featureFlags?: string
  authConfig?: string
  managedFieldPaths: string[]
  state: 'active' | 'suspended' | 'deleting' | 'deleted'
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
  resetAuth: () => Promise<void>
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
 *
 * resetAuth fires when feature flags change, since Better-Auth's
 * plugin set is built from flags + settings at boot.
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
    const authConfig =
      spec.auth !== undefined ? JSON.stringify(mergeAuthConfig(null, spec.auth)) : undefined
    await deps.createSettings({
      name: spec.workspace.name,
      slug: spec.workspace.slug,
      setupState,
      tierLimits: spec.tierLimits !== undefined ? JSON.stringify(spec.tierLimits) : undefined,
      featureFlags: spec.features !== undefined ? JSON.stringify(spec.features) : undefined,
      authConfig,
      managedFieldPaths: computeManagedPaths(spec),
      state: spec.state ?? 'active',
    })
    await deps.invalidateSettingsCache()
    await deps.invalidateTierLimitsCache()
    if (spec.auth !== undefined || spec.features !== undefined) await deps.resetAuth()
    return
  }

  const newPaths = computeManagedPaths(spec)
  const update: SettingsUpdate = { managedFieldPaths: newPaths }
  let touchedFeatures = false

  if (spec.workspace?.name !== undefined && spec.workspace.name !== current.name) {
    update.name = spec.workspace.name
  }
  if (spec.workspace?.slug !== undefined && spec.workspace.slug !== current.slug) {
    update.slug = spec.workspace.slug
  }

  if (spec.workspace !== undefined) {
    const setup = mergeSetupState(current.setupState, spec.workspace)
    const serialized = JSON.stringify(setup)
    if (serialized !== current.setupState) update.setupState = serialized
  }

  if (spec.tierLimits !== undefined) {
    const serialized = JSON.stringify(spec.tierLimits)
    if (serialized !== current.tierLimits) update.tierLimits = serialized
  }

  if (spec.features !== undefined) {
    const existing = current.featureFlags ? (safeJsonParse(current.featureFlags) ?? {}) : {}
    const merged = { ...existing, ...spec.features }
    const serialized = JSON.stringify(merged)
    if (serialized !== current.featureFlags) {
      update.featureFlags = serialized
      touchedFeatures = true
    }
  }

  let touchedAuth = false
  if (spec.auth !== undefined) {
    const merged = mergeAuthConfig(current.authConfig, spec.auth)
    const serialized = JSON.stringify(merged)
    if (serialized !== current.authConfig) {
      update.authConfig = serialized
      touchedAuth = true
    }
  }

  if (spec.state !== undefined && spec.state !== current.state) {
    update.state = spec.state
  }

  const pathsChanged = !arrayEquals(newPaths, current.managedFieldPaths)
  const hasFieldUpdates = Object.keys(update).length > 1 // > 1 because managedFieldPaths is always set

  if (!pathsChanged && !hasFieldUpdates) {
    return
  }

  await deps.updateSettings(update)
  await deps.invalidateSettingsCache()
  await deps.invalidateTierLimitsCache()
  // Better-Auth's plugin set + provider list is built from settings at
  // boot, so any auth/feature change has to drop the cached instance.
  if (touchedFeatures || touchedAuth) await deps.resetAuth()
}

interface SetupStateShape {
  version: number
  steps: { core: boolean; workspace: boolean; boards: boolean }
  useCase?: 'saas' | 'consumer' | 'marketplace' | 'internal'
  completedAt?: string
}

function mergeSetupState(
  existing: string | null,
  workspace: {
    name?: string
    slug?: string
    useCase?: 'saas' | 'consumer' | 'marketplace' | 'internal'
    onboardingComplete?: boolean
  }
): SetupStateShape {
  const parsed = existing ? (safeJsonParse(existing) as Partial<SetupStateShape> | null) : null
  const parsedSteps = parsed?.steps
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
    ? (parsed?.completedAt ?? new Date().toISOString())
    : parsed?.completedAt
  return {
    version: 1,
    steps: {
      core: forceComplete ? true : (parsedSteps?.core ?? true),
      workspace: forceComplete || fileSetsWorkspace ? true : (parsedSteps?.workspace ?? false),
      boards: forceComplete ? true : (parsedSteps?.boards ?? false),
    },
    useCase: workspace.useCase ?? parsed?.useCase,
    completedAt,
  }
}

/**
 * Per-key merge of `auth` over the existing auth config. The file
 * declares only what it wants to lock; absent fields keep their stored
 * value. openSignup falls back to existing → false in that order;
 * ssoOidc is merged per-key on top of the existing block.
 *
 * `existing` accepts the raw JSON string (or null) to keep callers
 * from having to pre-parse — this also runs at insert time, where
 * there is no row to read from.
 */
function mergeAuthConfig(
  existing: string | null,
  next: NonNullable<QuackbackConfigSpec['auth']>
): Record<string, unknown> {
  const parsed = existing ? safeJsonParse(existing) : null
  const safe = safeAuthExisting(parsed)
  const merged: Record<string, unknown> = {
    oauth: { ...safe.oauth, ...(next.oauth ?? {}) },
    openSignup: next.openSignup ?? safe.openSignup,
  }
  if (safe.ssoOidc) {
    merged.ssoOidc = safe.ssoOidc
  }
  if (next.ssoOidc !== undefined) {
    merged.ssoOidc = {
      ...(safe.ssoOidc ?? {}),
      ...next.ssoOidc,
    }
  }
  return merged
}

/**
 * Coerce parsed authConfig JSON to a known shape. Hardens the merge
 * against rows that pre-date the schema or were poked at by hand —
 * a stray `"oauth": "yes"` shouldn't crash the reconciler.
 */
function safeAuthExisting(parsed: Record<string, unknown> | null): {
  oauth: Record<string, boolean>
  openSignup: boolean
  ssoOidc: Record<string, unknown> | undefined
} {
  if (!parsed) return { oauth: {}, openSignup: false, ssoOidc: undefined }
  const oauthRaw = parsed.oauth
  const oauth: Record<string, boolean> = {}
  if (oauthRaw && typeof oauthRaw === 'object' && !Array.isArray(oauthRaw)) {
    for (const [k, v] of Object.entries(oauthRaw as Record<string, unknown>)) {
      if (typeof v === 'boolean') oauth[k] = v
    }
  }
  const openSignup = typeof parsed.openSignup === 'boolean' ? parsed.openSignup : false
  const ssoOidcRaw = parsed.ssoOidc
  const ssoOidc =
    ssoOidcRaw && typeof ssoOidcRaw === 'object' && !Array.isArray(ssoOidcRaw)
      ? (ssoOidcRaw as Record<string, unknown>)
      : undefined
  return { oauth, openSignup, ssoOidc }
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function arrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  for (let i = 0; i < sortedA.length; i++) if (sortedA[i] !== sortedB[i]) return false
  return true
}
