/**
 * Workspace Labs experiments — persisted visibility and enablement.
 *
 * Not a product feature-flag family. Unknown registry IDs never activate
 * features. Missing rows normalize to `{ visible: false, enabled: false }`.
 */
import type { WorkspaceId } from '@quackback/ids'
import { and, db, eq, settings, sql, workspaceExperiments } from '@/lib/server/db'
import type { AuditActor } from '@/lib/server/audit/log'
import { recordAuditEvent } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'
import { ForbiddenError, InternalError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  experimentStateMap,
  isRegisteredExperimentId,
  projectVisibleExperiments,
  resolveExperimentState,
  resolveVisualTheme,
  type ExperimentState,
  type VisibleExperiment,
  type VisualTheme,
} from '@/lib/shared/labs'
import { CACHE_KEYS } from '@/lib/server/cache'
import { kvDel } from '@/lib/server/kv/pg-kv'
import type { WorkspaceSettings } from './settings.types'

const log = logger.child({ component: 'settings-labs' })

function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

export type LabsProjection = {
  visualTheme: VisualTheme
  visibleExperiments: VisibleExperiment[]
}

export const DEFAULT_LABS_PROJECTION: LabsProjection = {
  visualTheme: 'legacy',
  visibleExperiments: [],
}

type ExperimentRow = {
  experimentId: string
  visible: boolean
  enabled: boolean
}

export async function requireWorkspaceSettingsId(): Promise<string> {
  const org = await db.query.settings.findFirst({ columns: { id: true } })
  if (!org) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  return org.id
}

export async function listExperimentRows(settingsId: string): Promise<ExperimentRow[]> {
  return db
    .select({
      experimentId: workspaceExperiments.experimentId,
      visible: workspaceExperiments.visible,
      enabled: workspaceExperiments.enabled,
    })
    .from(workspaceExperiments)
    .where(eq(workspaceExperiments.settingsId, asWorkspaceId(settingsId)))
}

export async function loadLabsProjection(settingsId: string): Promise<LabsProjection> {
  const states = experimentStateMap(await listExperimentRows(settingsId))
  return {
    visualTheme: resolveVisualTheme(states),
    visibleExperiments: projectVisibleExperiments(states),
  }
}

export function labsProjectionFromRows(rows: ExperimentRow[]): LabsProjection {
  const states = experimentStateMap(rows)
  return {
    visualTheme: resolveVisualTheme(states),
    visibleExperiments: projectVisibleExperiments(states),
  }
}

export function needsLabsProjectionRepair(
  settings: Pick<WorkspaceSettings, 'visualTheme'>
): boolean {
  return settings.visualTheme !== 'legacy' && settings.visualTheme !== 'refined'
}

export async function repairLabsProjection(cached: WorkspaceSettings): Promise<WorkspaceSettings> {
  if (!needsLabsProjectionRepair(cached)) return cached
  const settingsId = typeof cached.settings?.id === 'string' ? cached.settings.id : null
  if (!settingsId) {
    cached.visualTheme = 'legacy'
    return cached
  }
  const labs = await loadLabsProjection(settingsId)
  cached.visualTheme = labs.visualTheme
  return cached
}

export async function attachLabsProjection(
  settingsId: string
): Promise<Pick<WorkspaceSettings, 'visualTheme'>> {
  const labs = await loadLabsProjection(settingsId)
  return { visualTheme: labs.visualTheme }
}

function assertRegisteredExperimentId(experimentId: string): void {
  if (!isRegisteredExperimentId(experimentId)) {
    throw new ValidationError('UNKNOWN_EXPERIMENT', 'Unknown Labs experiment')
  }
}

async function readExperimentState(
  settingsId: string,
  experimentId: string
): Promise<ExperimentState> {
  const [row] = await db
    .select({
      visible: workspaceExperiments.visible,
      enabled: workspaceExperiments.enabled,
    })
    .from(workspaceExperiments)
    .where(
      and(
        eq(workspaceExperiments.settingsId, asWorkspaceId(settingsId)),
        eq(workspaceExperiments.experimentId, experimentId)
      )
    )
    .limit(1)
  return resolveExperimentState(row)
}

async function commitLabsChange(): Promise<void> {
  // kvDel (not cacheDel): cacheDel swallows failures, and a successful Labs
  // write must not leave the 1h settings cache on the previous visualTheme.
  try {
    await kvDel(CACHE_KEYS.WORKSPACE_SETTINGS, CACHE_KEYS.REGISTERED_AUTH_PROVIDERS)
  } catch (error) {
    log.error({ err: error }, 'labs cache invalidation failed after commit')
    throw new InternalError(
      'SETTINGS_CACHE_INVALIDATION_FAILED',
      'Saved, but the settings cache could not be refreshed. Retry the change.',
      error
    )
  }
}

async function auditLabsChange(input: {
  actor: AuditActor
  experimentId: string
  settingsId: string
  before: ExperimentState
  after: ExperimentState
  source: 'workspace' | 'operator'
}): Promise<void> {
  if (
    input.before.visible === input.after.visible &&
    input.before.enabled === input.after.enabled
  ) {
    return
  }
  await recordAuditEvent({
    event: 'labs.experiment.changed',
    actor: input.actor,
    target: { type: 'settings', id: input.settingsId },
    before: {
      experimentId: input.experimentId,
      visible: input.before.visible,
      enabled: input.before.enabled,
    },
    after: {
      experimentId: input.experimentId,
      visible: input.after.visible,
      enabled: input.after.enabled,
    },
    metadata: {
      experimentId: input.experimentId,
      source: input.source,
    },
  })
}

export async function listVisibleLabsExperiments(): Promise<VisibleExperiment[]> {
  const settingsId = await requireWorkspaceSettingsId()
  return (await loadLabsProjection(settingsId)).visibleExperiments
}

/**
 * Workspace mutation: enable/disable a visible, registered experiment.
 * Visibility is re-checked in the UPDATE predicate so a hide race cannot
 * activate from a stale preceding read.
 */
export async function setWorkspaceExperimentEnabled(input: {
  experimentId: string
  enabled: boolean
  actor: AuditActor
}): Promise<ExperimentState> {
  if (typeof input.enabled !== 'boolean') {
    throw new ValidationError('INVALID_EXPERIMENT_ENABLED', 'enabled must be a boolean')
  }
  assertRegisteredExperimentId(input.experimentId)

  const settingsId = await requireWorkspaceSettingsId()
  const before = await readExperimentState(settingsId, input.experimentId)

  const updated = await db
    .update(workspaceExperiments)
    .set({
      enabled: input.enabled,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspaceExperiments.settingsId, asWorkspaceId(settingsId)),
        eq(workspaceExperiments.experimentId, input.experimentId),
        eq(workspaceExperiments.visible, true)
      )
    )
    .returning({
      visible: workspaceExperiments.visible,
      enabled: workspaceExperiments.enabled,
    })

  if (updated.length === 0) {
    const current = await readExperimentState(settingsId, input.experimentId)
    if (current.visible && current.enabled === input.enabled) {
      return current
    }
    throw new ForbiddenError('EXPERIMENT_NOT_AVAILABLE', 'This experiment is not available')
  }

  const after = resolveExperimentState(updated[0])
  if (before.enabled !== after.enabled) {
    await auditLabsChange({
      actor: input.actor,
      experimentId: input.experimentId,
      settingsId,
      before,
      after,
      source: 'workspace',
    })
    await commitLabsChange()
  }
  return after
}

type OperatorColumn = 'visible' | 'enabled'

/**
 * Operator configuration. Updates one boolean without overwriting the other.
 * Visibility is not required to enable or disable.
 */
export async function setOperatorExperimentColumn(input: {
  experimentId: string
  column: OperatorColumn
  value: boolean
  actor: AuditActor
  settingsId?: string
}): Promise<ExperimentState> {
  if (typeof input.value !== 'boolean') {
    throw new ValidationError('INVALID_EXPERIMENT_VALUE', `${input.column} must be a boolean`)
  }
  assertRegisteredExperimentId(input.experimentId)

  const settingsId = input.settingsId ?? (await requireWorkspaceSettingsId())
  const org = await db.query.settings.findFirst({
    columns: { id: true },
    where: eq(settings.id, asWorkspaceId(settingsId)),
  })
  if (!org) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Workspace settings not found')

  const before = await readExperimentState(settingsId, input.experimentId)

  const insertValues = {
    settingsId: asWorkspaceId(settingsId),
    experimentId: input.experimentId,
    visible: input.column === 'visible' ? input.value : false,
    enabled: input.column === 'enabled' ? input.value : false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const conflictSet =
    input.column === 'visible'
      ? {
          visible: sql`excluded.visible`,
          updatedAt: sql`excluded.updated_at`,
        }
      : {
          enabled: sql`excluded.enabled`,
          updatedAt: sql`excluded.updated_at`,
        }

  const [row] = await db
    .insert(workspaceExperiments)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [workspaceExperiments.settingsId, workspaceExperiments.experimentId],
      set: conflictSet,
    })
    .returning({
      visible: workspaceExperiments.visible,
      enabled: workspaceExperiments.enabled,
    })

  const after = resolveExperimentState(row)
  await auditLabsChange({
    actor: input.actor,
    experimentId: input.experimentId,
    settingsId,
    before,
    after,
    source: 'operator',
  })
  if (before.visible !== after.visible || before.enabled !== after.enabled) {
    await commitLabsChange()
  }
  return after
}

export async function getExperimentStateForWorkspace(
  experimentId: string,
  settingsId?: string
): Promise<ExperimentState> {
  assertRegisteredExperimentId(experimentId)
  const id = settingsId ?? (await requireWorkspaceSettingsId())
  return readExperimentState(id, experimentId)
}

/** Column-specific upsert payload used by tests to prove independence. */
export function operatorConflictSet(column: OperatorColumn): readonly string[] {
  return column === 'visible' ? ['visible', 'updatedAt'] : ['enabled', 'updatedAt']
}

export function workspaceEnableUpdateSet(): readonly string[] {
  return ['enabled', 'updatedAt']
}
