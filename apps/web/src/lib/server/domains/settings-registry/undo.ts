/**
 * Undoing a settings receipt: the audit row of a direct write, or a settings
 * card a person applied.
 */
import { and, auditLog, assistantPendingActions, db, eq, settings } from '@/lib/server/db'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import { settingsReceiptIdSchema, type SettingsArea } from '@/lib/shared/settings-registry'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { requireAreaPermission } from '@/lib/server/domains/assistant/settings-proposals.areas'
import type { SettingsApplyReceipt } from '@/lib/server/domains/assistant/settings-proposals.storage'
import { undoWorkspaceSettingsProposal } from '@/lib/server/domains/assistant/workspace-settings-actions.service'
import { getSettingsArea } from './registry'
import { auditActor, type SettingsCaller } from './service'

export interface UndoSettingsResult {
  id: string
  area: SettingsArea | null
  undone: true
  undoneAt: string
}

export interface UndoSettingsOutcome {
  status: 'undone'
  result: UndoSettingsResult
}

/**
 * Undo a receipt while the values it wrote have not moved. A receipt is the
 * audit row of a direct write, or a settings card a person applied.
 */
export async function undoSettingsReceipt(
  caller: SettingsCaller,
  receiptId: string
): Promise<UndoSettingsOutcome> {
  const { actor } = caller
  const parsed = settingsReceiptIdSchema.safeParse(receiptId)
  if (!parsed.success)
    throw new NotFoundError('SETTINGS_RECEIPT_NOT_FOUND', 'Settings receipt not found')
  if (receiptId.startsWith('assistant_action_')) return undoSettingsCard(caller, receiptId)
  const result = await db.transaction(async (tx) => {
    const [receiptRow] = await tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.id, receiptId as never), eq(auditLog.eventType, 'settings.applied')))
      .limit(1)
    const receipt = (receiptRow?.metadata as { receipt?: SettingsApplyReceipt } | null)?.receipt
    if (!receiptRow || !receipt)
      throw new NotFoundError('SETTINGS_RECEIPT_NOT_FOUND', 'Settings receipt not found')
    const entry = getSettingsArea(receiptRow.targetId ?? '')
    caller.assertAreaScope?.(entry.id)
    // Serialise undo and apply on the one settings row.
    await tx.select({ id: settings.id }).from(settings).limit(1).for('update')
    const [already] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.eventType, 'settings.undone'), eq(auditLog.targetId, receiptId)))
      .limit(1)
    if (already)
      throw new ConflictError('SETTINGS_UNDO_UNAVAILABLE', 'This change was already undone')
    try {
      await entry.undo(tx, actor, receipt)
    } catch (error) {
      if ((error as { code?: string }).code === 'SETTINGS_UNDO_CONFLICT')
        throw new ConflictError('SETTINGS_UNDO_CONFLICT', (error as Error).message)
      throw error
    }
    await recordAuditEventInTransaction(tx, {
      event: 'settings.undone',
      actor: await auditActor(tx, actor),
      target: { type: 'settings_receipt', id: receiptId },
      before: receipt.changes.map((change) => ({ id: change.id, value: change.after })),
      after: receipt.changes.map((change) => ({ id: change.id, value: change.before })),
      metadata: { area: receiptRow.targetId, principalId: actor.principalId },
    })
    return entry.id
  })
  await invalidateSettingsCache()
  return {
    status: 'undone',
    result: { id: receiptId, area: result, undone: true, undoneAt: new Date().toISOString() },
  }
}

async function undoSettingsCard(caller: SettingsCaller, id: string): Promise<UndoSettingsOutcome> {
  const { actor } = caller
  const [row] = await db
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, id as never))
    .limit(1)
  const receipt = row?.result as unknown as SettingsApplyReceipt | null
  if (!row || row.toolName !== 'propose_settings_change' || !receipt?.changes)
    throw new NotFoundError('SETTINGS_RECEIPT_NOT_FOUND', 'Settings receipt not found')
  if (row.status !== 'executed' || (row.result as { undoneAt?: string }).undoneAt)
    throw new ConflictError('SETTINGS_UNDO_UNAVAILABLE', 'This change cannot be undone')
  const areas = [...new Set(receipt.changes.map((change) => change.area))]
  for (const area of areas) {
    caller.assertAreaScope?.(area)
    await requireAreaPermission(actor, area, db)
  }

  const undone = await undoWorkspaceSettingsProposal(actor, id as never, 'settings.undone')
  return {
    status: 'undone',
    result: {
      id,
      area: areas.length === 1 ? areas[0] : null,
      undone: true,
      undoneAt: String((undone.result as { undoneAt?: string } | null)?.undoneAt),
    },
  }
}
