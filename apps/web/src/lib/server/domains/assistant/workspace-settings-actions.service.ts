import { randomUUID } from 'node:crypto'
import type { AssistantPendingActionId } from '@quackback/ids'
import {
  db,
  eq,
  and,
  gt,
  assistantPendingActions,
  principal,
  user,
  type Transaction,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import {
  settingsProposalInputSchema,
  settingsProposalSchema,
  type SettingsProposal,
} from '@/lib/shared/assistant/settings-proposals'
import {
  applySettingsChangesInTransaction,
  undoSettingsChangesInTransaction,
  invalidateSettingsCache,
  type SettingsApplyReceipt,
} from './settings-proposals.service'
import { requireAreaPermission } from './settings-proposals.areas'
import {
  resolveWebsiteSettingsInputs,
  prepareResolvedWebsiteSettingsChanges,
} from './website-settings-proposal'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertWorkspaceThreadOwned, createWorkspaceThread } from './workspace-threads.service'
import { publishWorkspaceProposalReviewInTransaction } from './workspace-proposal-review'
import type { AssistantPendingAction } from './pending-actions.service'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'

export async function enqueueWorkspaceSettingsProposal(
  actor: Actor,
  inputs: unknown[],
  threadKey?: string,
  turnId?: string
): Promise<
  AssistantPendingAction & {
    reviewHref?: string
    preparationNotes?: Array<'website_color_unavailable'>
  }
> {
  const parsed = settingsProposalInputSchema.parse({ changes: inputs }).changes
  if (parsed.some((input) => input.area === 'branding' && input.patch.website !== undefined)) {
    await requireAreaPermission(actor, 'branding', db, PERMISSIONS.COPILOT_USE)
    if (threadKey) await assertWorkspaceThreadOwned(threadKey, actor)
  }
  const resolved = await resolveWebsiteSettingsInputs(actor, parsed)
  const result = await db.transaction(async (tx) => {
    // A dedicated review keeps external proposals out of an active chat's history.
    const key = threadKey ?? (await createWorkspaceThread(actor, '', tx)).key
    await assertWorkspaceThreadOwned(key, actor, tx, true)
    const proposal = await prepareResolvedWebsiteSettingsChanges(actor, resolved, tx)
    const idempotencyKey = `workspace-settings:${key}:${turnId ?? randomUUID()}`
    const [existing] = await tx
      .select()
      .from(assistantPendingActions)
      .where(
        and(
          eq(assistantPendingActions.workspaceThreadKey, key),
          eq(assistantPendingActions.idempotencyKey, idempotencyKey),
          eq(assistantPendingActions.status, 'proposed'),
          gt(assistantPendingActions.expiresAt, new Date())
        )
      )
      .limit(1)
      .for('update')
    if (existing) {
      const previous = settingsProposalSchema.parse(existing.args)
      const changes = new Map(previous.changes.map((change) => [change.id, change]))
      for (const change of proposal.changes) {
        const old = changes.get(change.id)
        changes.set(change.id, { ...change, before: old ? old.before : change.before })
      }
      const combined: SettingsProposal = {
        kind: 'settings',
        version: 1,
        changes: [...changes.values()],
      }
      const [updated] = await tx
        .update(assistantPendingActions)
        .set({
          args: combined as unknown as Record<string, unknown>,
          summary: `${combined.changes.length} settings changes`,
        })
        .where(eq(assistantPendingActions.id, existing.id))
        .returning()
      return threadKey
        ? updated
        : {
            ...updated,
            reviewHref: await publishWorkspaceProposalReviewInTransaction(tx, actor, updated),
          }
    }
    const [row] = await tx
      .insert(assistantPendingActions)
      .values({
        workspaceThreadKey: key,
        toolName: 'propose_settings_change',
        args: proposal as unknown as Record<string, unknown>,
        summary: `${proposal.changes.length} settings changes`,
        originRole: 'workspace_assistant',
        idempotencyKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning()
    return threadKey
      ? row
      : { ...row, reviewHref: await publishWorkspaceProposalReviewInTransaction(tx, actor, row) }
  })
  return resolved.preparationNotes.length
    ? { ...result, preparationNotes: resolved.preparationNotes }
    : result
}
async function lockedOwnedAction(
  id: AssistantPendingActionId,
  actor: Actor,
  tx: Transaction
): Promise<AssistantPendingAction> {
  const [snapshot] = await tx
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, id))
    .limit(1)
  if (!snapshot?.workspaceThreadKey)
    throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
  // Thread comes first everywhere, including proposal merging, so locks cannot invert.
  await assertWorkspaceThreadOwned(snapshot.workspaceThreadKey, actor, tx, true)
  const [row] = await tx
    .select()
    .from(assistantPendingActions)
    .where(
      and(
        eq(assistantPendingActions.id, id),
        eq(assistantPendingActions.workspaceThreadKey, snapshot.workspaceThreadKey)
      )
    )
    .limit(1)
    .for('update')
  if (!row) throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
  return row
}
async function audit(
  tx: Transaction,
  actor: Actor,
  event: 'copilot.settings.applied' | 'copilot.settings.undone',
  id: string,
  changes: SettingsProposal['changes']
) {
  const [person] = await tx
    .select({ userId: principal.userId, email: user.email })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(eq(principal.id, actor.principalId!))
    .limit(1)
  await recordAuditEventInTransaction(tx, {
    event,
    actor: { userId: person?.userId, email: person?.email, role: actor.role, type: 'user' },
    target: { type: 'assistant_pending_action', id },
    before: changes.map((change) => ({ id: change.id, value: change.before })),
    after: changes.map((change) => ({ id: change.id, value: change.after })),
    metadata: { via: 'copilot', principalId: actor.principalId },
  })
}
export async function applyWorkspaceSettingsProposal(
  actor: Actor,
  id: AssistantPendingActionId,
  selectedChangeIds: string[]
): Promise<AssistantPendingAction> {
  const result = await db.transaction(async (tx) => {
    const pending = await lockedOwnedAction(id, actor, tx)
    if (
      pending.toolName !== 'propose_settings_change' ||
      pending.status !== 'proposed' ||
      pending.expiresAt.getTime() <= Date.now()
    )
      throw new ConflictError(
        'PENDING_ACTION_NOT_DECIDABLE',
        'This request was already decided or has expired'
      )
    const proposal = settingsProposalSchema.parse(pending.args)
    const receipt = await applySettingsChangesInTransaction(tx, actor, proposal, selectedChangeIds)
    await audit(tx, actor, 'copilot.settings.applied', pending.id, receipt.changes)
    const [row] = await tx
      .update(assistantPendingActions)
      .set({
        status: 'executed',
        decidedById: actor.principalId,
        decidedAt: new Date(),
        executedAt: new Date(),
        result: receipt as unknown as Record<string, unknown>,
      })
      .where(eq(assistantPendingActions.id, id))
      .returning()
    return row
  })
  await invalidateSettingsCache()
  return result
}
export async function undoWorkspaceSettingsProposal(
  actor: Actor,
  id: AssistantPendingActionId
): Promise<AssistantPendingAction> {
  const result = await db.transaction(async (tx) => {
    const pending = await lockedOwnedAction(id, actor, tx)
    if (
      pending.toolName !== 'propose_settings_change' ||
      pending.status !== 'executed' ||
      !pending.result ||
      pending.result.undoneAt
    )
      throw new ConflictError('SETTINGS_UNDO_UNAVAILABLE', 'This change cannot be undone')
    const receipt = pending.result as unknown as SettingsApplyReceipt
    await undoSettingsChangesInTransaction(tx, actor, receipt)
    await audit(
      tx,
      actor,
      'copilot.settings.undone',
      pending.id,
      receipt.changes.map((change) => ({ ...change, before: change.after, after: change.before }))
    )
    const [row] = await tx
      .update(assistantPendingActions)
      .set({ result: { ...pending.result, undoneAt: new Date().toISOString() } })
      .where(eq(assistantPendingActions.id, id))
      .returning()
    return row
  })
  await invalidateSettingsCache()
  return result
}
