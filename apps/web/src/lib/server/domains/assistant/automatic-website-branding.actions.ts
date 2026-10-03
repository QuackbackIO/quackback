import { db, eq, settings, assistantPendingActions, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'
import { undoSettingsChangesInTransaction } from './settings-proposals.service'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/shared/errors'
import {
  writeMetadataKey,
  invalidateSettingsCache,
} from '@/lib/server/domains/settings/settings.helpers'
import {
  AUTOMATIC_BRANDING_SOURCE,
  automaticBrandingPermissionError,
  automaticBrandingUnavailable,
  automaticReceiptFor,
  lookupFromRow,
  receiptPermissions,
  resolveAutomaticBrandingActor,
  statusFromLookup,
  type AutomaticBrandingReceipt,
  type AutomaticPendingAction,
} from './automatic-website-branding.state'

export async function auditAutomaticBranding(
  tx: Transaction,
  person: Awaited<ReturnType<typeof resolveAutomaticBrandingActor>>,
  event: 'branding.website.applied' | 'branding.website.undone',
  id: string,
  receipt: AutomaticBrandingReceipt
) {
  const undo = event === 'branding.website.undone'
  await recordAuditEventInTransaction(tx, {
    event,
    actor: { userId: person.userId, email: person.email, role: person.role, type: 'user' },
    target: { type: 'assistant_pending_action', id },
    before: receipt.changes.map((change) => ({
      id: change.id,
      value: undo ? change.after : change.before,
    })),
    after: receipt.changes.map((change) => ({
      id: change.id,
      value: undo ? change.before : change.after,
    })),
    metadata: {
      via: AUTOMATIC_BRANDING_SOURCE,
      domain: receipt.domain,
      settingsId: receipt.settingsId,
      principalId: person.actor.principalId,
    },
  })
}
export async function undoAutomaticWebsiteBranding(actor: Actor) {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).limit(1).for('update')
    if (!row) throw automaticBrandingUnavailable()
    const person = await resolveAutomaticBrandingActor(actor, tx)
    const lookup = lookupFromRow(row)
    if (!lookup || lookup.status !== 'applied' || !lookup.pendingActionId)
      throw automaticBrandingUnavailable()
    const [pending] = await tx
      .select()
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, lookup.pendingActionId as AutomaticPendingAction['id']))
      .limit(1)
      .for('update')
    const receipt = automaticReceiptFor(row, lookup, pending)
    if (!receipt || receipt.undoneAt) throw automaticBrandingUnavailable()
    if (!receiptPermissions(person.permissions, receipt)) throw automaticBrandingPermissionError()
    try {
      await undoSettingsChangesInTransaction(tx, person.actor, receipt)
    } catch (error) {
      if (error instanceof ForbiddenError) throw automaticBrandingPermissionError()
      if (error instanceof ValidationError && error.code === 'SETTINGS_UNDO_CONFLICT')
        throw new ConflictError(
          'WEBSITE_BRANDING_UNDO_CONFLICT',
          'The branding changed since the lookup. Undo is unavailable.'
        )
      throw error
    }
    await auditAutomaticBranding(tx, person, 'branding.website.undone', pending.id, receipt)
    const completedAt = new Date().toISOString()
    await tx
      .update(assistantPendingActions)
      .set({ result: { ...pending.result, undoneAt: completedAt } })
      .where(eq(assistantPendingActions.id, pending.id))
    const next = { ...lookup, status: 'undone' as const, completedAt }
    await writeMetadataKey('brandingLookup', next, { executor: tx })
    return statusFromLookup(next)
  })
  await invalidateSettingsCache()
  return result
}
