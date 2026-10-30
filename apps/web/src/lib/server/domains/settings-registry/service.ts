/**
 * What the settings registry does on behalf of a caller, whatever the surface:
 * list the areas, read one, change one (preview or apply) and undo a receipt.
 *
 * The REST routes and the MCP tools call these and only translate the result
 * to their own wire format, so each rule lives once.
 */
import { db, eq, principal, settings, user, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import {
  LockedError,
  NotFoundError,
  PreconditionFailedError,
  PreconditionRequiredError,
} from '@/lib/shared/errors'
import type {
  LockedField,
  SettingsArea,
  SettingsChangeEntry,
  SettingsReceipt,
  SettingsRisk,
} from '@/lib/shared/settings-registry'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'
import {
  requireSettings,
  invalidateSettingsCache,
} from '@/lib/server/domains/settings/settings.helpers'
import { requireAreaPermission } from '@/lib/server/domains/assistant/settings-proposals.areas'
import { prepareSettingsChanges } from '@/lib/server/domains/assistant/settings-proposals.service'
import { settingsProposalRisk } from '@/lib/server/domains/assistant/approval-policy'
import {
  getSettingsArea,
  parseAreaPatch,
  SETTINGS_REGISTRY,
  type SettingsAreaEntry,
} from './registry'

/** Who is asking. A change applies with the caller's own permissions. */
export interface SettingsCaller {
  actor: Actor
  /** Checks the credential's own scope for an area it is about to write. */
  assertAreaScope?: (area: SettingsArea) => void
}

/** What a caller must hold for a change to an area to take effect. */
export interface SettingsGates {
  permission: string
}

export interface SettingsAreaSummary {
  id: SettingsArea
  title: string
  description: string
  risk: SettingsRisk
  revision: string
  locked: LockedField[]
  gates: SettingsGates
}

export interface SettingsAreaRead extends SettingsAreaSummary {
  value: Record<string, unknown>
  /** Whether each secret field is set. No area holds one yet. */
  secrets: Record<string, boolean>
}

function gatesOf(entry: SettingsAreaEntry): SettingsGates {
  return { permission: entry.permission }
}

function summaryOf(entry: SettingsAreaEntry, row: Awaited<ReturnType<typeof requireSettings>>) {
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    risk: entry.risk,
    revision: entry.revision(row),
    locked: entry.lockedFields(row),
    gates: gatesOf(entry),
  }
}

/** The areas the actor may read, with each one's risk, revision and gates. */
export async function listSettingsAreas(actor: Actor): Promise<SettingsAreaSummary[]> {
  const row = await requireSettings(db)
  const held = actor.principalId ? await heldPermissions(actor) : new Set<string>()
  return Object.values(SETTINGS_REGISTRY)
    .filter((entry) => held.has(entry.permission))
    .map((entry) => summaryOf(entry, row))
}

async function heldPermissions(actor: Actor): Promise<Set<string>> {
  const [record] = await db
    .select({ role: principal.role })
    .from(principal)
    .where(eq(principal.id, actor.principalId!))
    .limit(1)
  if (!record || (record.role !== 'admin' && record.role !== 'member')) return new Set()
  const stored = await permissionsForPrincipal(actor.principalId!, record.role)
  return new Set(
    [...stored].filter((permission) => !actor.permissions || actor.permissions.has(permission))
  )
}

/** One area's value, revision and locked fields. */
export async function readSettingsArea(actor: Actor, id: string): Promise<SettingsAreaRead> {
  const entry = getSettingsArea(id)
  await requireAreaPermission(actor, entry.id, db)
  const row = await requireSettings(db)
  const value = entry.read(row)
  return {
    ...summaryOf(entry, row),
    value,
    secrets: Object.fromEntries(
      entry.secretFields.map((field) => [field, value[`${field}Set`]])
    ) as Record<string, boolean>,
  }
}

export interface ChangeSettingsInput {
  patch: unknown
  /** The revision the caller read. Required unless this is a dry run. */
  expectedRevision?: string | null
  dryRun?: boolean
}

export interface SettingsPreview {
  area: SettingsArea
  risk: SettingsRisk
  revision: string
  changes: SettingsChangeEntry[]
}

export type ChangeSettingsResult =
  | { status: 'dry_run'; preview: SettingsPreview }
  | { status: 'noop'; revision: string }
  | { status: 'applied'; receipt: SettingsReceipt }

/** Strip the quotes and weak marker an If-Match value may carry. */
export function normalizeRevision(header: string): string {
  return header
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1')
}

/** A patch that moves a locked field to a value other than the one it holds is refused. */
function assertNotLocked(
  entry: SettingsAreaEntry,
  row: Awaited<ReturnType<typeof requireSettings>>,
  patch: Record<string, unknown>
): void {
  const current = entry.read(row)
  const touched = entry
    .lockedFields(row)
    .filter(
      (lock) =>
        lock.field in patch &&
        JSON.stringify(patch[lock.field]) !== JSON.stringify(current[lock.field])
    )
  if (touched.length > 0)
    throw new LockedError(
      'FIELD_LOCKED',
      `${touched.map((lock) => lock.field).join(', ')} cannot be changed here: ${
        touched.some((lock) => lock.reason === 'config_file')
          ? "managed by your administrator's config"
          : 'managed by the workspace operator'
      }.`,
      { locked: touched }
    )
}

function assertRevision(
  entry: SettingsAreaEntry,
  row: Awaited<ReturnType<typeof requireSettings>>,
  expected: string
): string {
  const current = entry.revision(row)
  if (normalizeRevision(expected) !== current)
    throw new PreconditionFailedError(
      'REVISION_MISMATCH',
      'These settings changed since you read them. Read them again and resend the change.',
      { revision: current }
    )
  return current
}

export async function auditActor(tx: Transaction, actor: Actor) {
  const [person] = await tx
    .select({ userId: principal.userId, email: user.email })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(eq(principal.id, actor.principalId!))
    .limit(1)
  return { userId: person?.userId, email: person?.email, role: actor.role, type: 'user' as const }
}

/**
 * Change one area. The change applies at once with the caller's permissions,
 * in one transaction that also writes its audit event and returns a receipt
 * the caller can undo.
 */
export async function changeSettingsArea(
  caller: SettingsCaller,
  id: string,
  input: ChangeSettingsInput
): Promise<ChangeSettingsResult> {
  const entry = getSettingsArea(id)
  const { actor } = caller
  const patch = parseAreaPatch(entry, input.patch)
  caller.assertAreaScope?.(entry.id)
  await requireAreaPermission(actor, entry.id, db)
  const row = await requireSettings(db)
  assertNotLocked(entry, row, patch)
  const expected = input.expectedRevision?.trim()
  const revision = expected ? assertRevision(entry, row, expected) : entry.revision(row)

  let proposal: Awaited<ReturnType<typeof prepareSettingsChanges>> | null = null
  try {
    proposal = await prepareSettingsChanges(actor, [{ area: entry.id, patch } as never])
  } catch (error) {
    if ((error as { code?: string }).code !== 'SETTINGS_ALREADY_MATCH') throw error
  }
  // The diff decides the tier, so a bulk change is medium on every surface.
  const risk: SettingsRisk = proposal ? settingsProposalRisk(proposal) : entry.risk

  if (input.dryRun) {
    return {
      status: 'dry_run',
      preview: {
        area: entry.id,
        risk,
        revision,
        changes:
          proposal?.changes.map(({ path, before, after }) => ({ path, before, after })) ?? [],
      },
    }
  }
  if (!expected)
    throw new PreconditionRequiredError(
      'IF_MATCH_REQUIRED',
      'Send the revision you read as If-Match.'
    )
  if (!proposal) return { status: 'noop', revision }

  return applyLocked(caller, entry, patch, expected)
}

async function applyLocked(
  caller: SettingsCaller,
  entry: SettingsAreaEntry,
  patch: Record<string, unknown>,
  expected: string
): Promise<ChangeSettingsResult> {
  const { actor } = caller
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(settings).limit(1).for('update')
    if (!locked) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    assertNotLocked(entry, locked, patch)
    assertRevision(entry, locked, expected)
    const outcome = await entry.apply(tx, actor, patch)
    if (!outcome.receipt) return { outcome, receiptId: null, revision: entry.revision(locked) }
    const [after] = await tx.select().from(settings).limit(1)
    const revision = entry.revision(after)
    const receiptId = await recordAuditEventInTransaction(tx, {
      event: 'settings.applied',
      actor: await auditActor(tx, actor),
      target: { type: 'settings_area', id: entry.id },
      before: outcome.receipt.changes.map((change) => ({ id: change.id, value: change.before })),
      after: outcome.receipt.changes.map((change) => ({ id: change.id, value: change.after })),
      metadata: {
        area: entry.id,
        risk: entry.risk,
        revision,
        principalId: actor.principalId,
        receipt: outcome.receipt,
      },
    })
    return { outcome, receiptId, revision }
  })
  if (!result.outcome.receipt || !result.receiptId)
    return { status: 'noop', revision: result.revision }
  await invalidateSettingsCache()
  return {
    status: 'applied',
    receipt: {
      id: result.receiptId,
      area: entry.id,
      appliedAt: result.outcome.receipt.appliedAt,
      revision: result.revision,
      changes: result.outcome.changes,
      before: result.outcome.before,
      after: result.outcome.after,
      undoable: result.outcome.receipt.storageEffects.length > 0,
    },
  }
}
