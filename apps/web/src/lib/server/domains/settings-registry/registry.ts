/**
 * The settings registry: one entry per area, shared by the app, the REST API
 * and MCP.
 *
 * An entry joins the pure table (`lib/shared/settings-registry`:
 * permission, schemas) to the handlers that read, apply and undo. The handlers
 * wrap the services the settings pages already call, so caching, plan checks
 * and config-file locks stay where they are; nothing here writes a column.
 */
import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { settings, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  SETTINGS_AREA_META,
  SETTINGS_AREAS,
  settingsAreaPatchSchemas,
  settingsReadSchemas,
  type LockedField,
  type SettingsArea,
  type SettingsAreaMeta,
  type SettingsChangeEntry,
} from '@/lib/shared/settings-registry'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'
import type { SettingsRecord } from '@/lib/server/domains/settings/settings.helpers'
import { areaValues } from '@/lib/server/domains/assistant/settings-proposals.areas'
import {
  applySettingsChangesInTransaction,
  prepareSettingsChanges,
  undoSettingsChangesInTransaction,
  type SettingsApplyReceipt,
} from '@/lib/server/domains/assistant/settings-proposals.service'

/** What an apply did: the changed leaves and the receipt the undo needs. */
export interface AreaApplyOutcome {
  changes: SettingsChangeEntry[]
  /** Null when the patch already matched, so nothing was written. */
  receipt: SettingsApplyReceipt | null
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface SettingsAreaEntry extends SettingsAreaMeta {
  readSchema: z.ZodType
  patchSchema: z.ZodType
  /** Fields whose value is never returned; a read says only whether each is set. */
  secretFields: readonly string[]
  /** Fields the config file or the operator holds, for the row as it is now. */
  lockedFields(row: SettingsRecord): LockedField[]
  /** The area's value, with secrets reduced to whether they are set. */
  read(row: SettingsRecord): Record<string, unknown>
  /** A hash of the value: it moves when anything in the area moves. */
  revision(row: SettingsRecord): string
  /** Apply a validated patch inside the caller's transaction. */
  apply(tx: Transaction, actor: Actor, patch: Record<string, unknown>): Promise<AreaApplyOutcome>
  /** Restore what a receipt recorded, while the values have not moved. */
  undo(tx: Transaction, actor: Actor, receipt: SettingsApplyReceipt): Promise<void>
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** The revision of a value: the first 32 hex characters of its canonical hash. */
export function revisionOf(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 32)
}

function changeEntries(receipt: SettingsApplyReceipt): SettingsChangeEntry[] {
  return receipt.changes.map(({ path, before, after }) => ({ path, before, after }))
}

function define(
  id: SettingsArea,
  options: {
    secretFields?: readonly string[]
    lockedFields?: (row: SettingsRecord) => LockedField[]
  } = {}
): SettingsAreaEntry {
  const meta = SETTINGS_AREA_META[id]
  const secretFields = options.secretFields ?? []
  return {
    ...meta,
    readSchema: settingsReadSchemas[id],
    patchSchema: settingsAreaPatchSchemas[id],
    secretFields,
    lockedFields: options.lockedFields ?? (() => []),
    read: (row) => {
      const value = areaValues(row, id)
      for (const field of secretFields) {
        value[`${field}Set`] = Boolean(value[field])
        delete value[field]
      }
      return value
    },
    revision: (row) => revisionOf(areaValues(row, id)),
    apply: async (tx, actor, patch) => {
      const [before] = await tx.select().from(settings).limit(1).for('update')
      if (!before) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
      const beforeValue = areaValues(before, id)
      let proposal
      try {
        proposal = await prepareSettingsChanges(actor, [{ area: id, patch } as never], tx)
      } catch (error) {
        if ((error as { code?: string }).code === 'SETTINGS_ALREADY_MATCH')
          return { changes: [], receipt: null, before: beforeValue, after: beforeValue }
        throw error
      }
      const receipt = await applySettingsChangesInTransaction(
        tx,
        actor,
        proposal,
        proposal.changes.map((change) => change.id)
      )
      const [after] = await tx.select().from(settings).limit(1)
      return {
        changes: changeEntries(receipt),
        receipt,
        before: beforeValue,
        after: areaValues(after, id),
      }
    },
    undo: (tx, actor, receipt) => undoSettingsChangesInTransaction(tx, actor, receipt),
  }
}

/** The workspace name is held by the config file or, on a managed workspace, its operator. */
function portalLocks(row: SettingsRecord): LockedField[] {
  if (isPathManaged('workspace.name', row.managedFieldPaths ?? []))
    return [{ field: 'displayName', reason: 'config_file' }]
  if (parseIdentityProjection(row.cloudIdentity))
    return [{ field: 'displayName', reason: 'operator' }]
  return []
}

export const SETTINGS_REGISTRY: Record<SettingsArea, SettingsAreaEntry> = {
  branding: define('branding'),
  portal: define('portal', { lockedFields: portalLocks }),
  office_hours: define('office_hours'),
  messenger: define('messenger'),
  modules: define('modules'),
  changelog: define('changelog'),
}

/** The entry for an area id, or a not-found error for one the registry does not have. */
export function getSettingsArea(id: string): SettingsAreaEntry {
  if (!(SETTINGS_AREAS as readonly string[]).includes(id))
    throw new NotFoundError('SETTINGS_AREA_NOT_FOUND', `Unknown settings area "${id}"`)
  return SETTINGS_REGISTRY[id as SettingsArea]
}

export function parseAreaPatch(entry: SettingsAreaEntry, patch: unknown): Record<string, unknown> {
  const parsed = entry.patchSchema.safeParse(patch)
  if (!parsed.success)
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Invalid settings patch',
      parsed.error.flatten().fieldErrors
    )
  return parsed.data as Record<string, unknown>
}
