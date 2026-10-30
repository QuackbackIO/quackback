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
  type SettingsArea,
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
import {
  decidePendingAction,
  markPendingActionExecuted,
  type AssistantPendingAction,
} from './pending-actions.service'
import {
  SETTINGS_PROPOSAL_TOOL,
  settingsProposalPermissions,
  settingsProposalRisk,
  summarizeSettingsProposal,
} from './approval-policy'
import {
  approvalContentDigest,
  assertMayDecide,
  assertStillPending,
  isDecidableApproval,
  lockApprovalForDecision,
  requesterColumns,
  type ApprovalDecisionInput,
  type ApprovalRequester,
} from './approvals.service'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'

const AREA_WORDS: Record<SettingsArea, string> = {
  branding: 'branding',
  portal: 'portal',
  messenger: 'messenger',
  modules: 'modules',
  office_hours: 'office hours',
  changelog: 'changelog',
}

/** The title of the review thread a proposal opens, from the areas it changes. */
function proposalThreadTitle(areas: SettingsArea[]): string {
  const words = [...new Set(areas)].map((area) => AREA_WORDS[area])
  const named =
    words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0]
  return `Change ${named} settings`
}

const SETTINGS_REQUEST_TTL_MS = 24 * 60 * 60 * 1000

/**
 * File a settings request in one card. The title and risk are written here,
 * from the diff; nothing the requesting agent wrote becomes either.
 *
 * A pending card is never edited. A second proposal in the same turn files a
 * combined card and retires the first (`superseded:merged`), so a decision
 * always names content that was never changed under it.
 */
export async function enqueueWorkspaceSettingsProposal(
  actor: Actor,
  inputs: unknown[],
  threadKey?: string,
  turnId?: string,
  requester?: ApprovalRequester,
  /** Runs first inside the filing transaction, for a check that must hold under its lock. */
  guard?: (tx: Transaction) => Promise<void>
): Promise<
  AssistantPendingAction & {
    reviewHref?: string
    preparationNotes?: Array<'website_color_unavailable'>
    /** The card this one replaced, when it combined a same-turn request. */
    supersededId?: AssistantPendingActionId
  }
> {
  const parsed = settingsProposalInputSchema.parse({ changes: inputs }).changes
  if (parsed.some((input) => input.area === 'branding' && input.patch.website !== undefined)) {
    await requireAreaPermission(actor, 'branding', db, PERMISSIONS.COPILOT_USE)
    if (threadKey) await assertWorkspaceThreadOwned(threadKey, actor)
  }
  const resolved = await resolveWebsiteSettingsInputs(actor, parsed)
  const filedBy: ApprovalRequester = {
    ...(requester ?? { via: 'assistant' }),
    onBehalfOfPrincipalId: requester?.onBehalfOfPrincipalId ?? actor.principalId,
  }
  const result = await db.transaction(async (tx) => {
    await guard?.(tx)
    // A dedicated review keeps external proposals out of an active chat's history.
    const key =
      threadKey ??
      (await createWorkspaceThread(actor, proposalThreadTitle(parsed.map((c) => c.area)), tx)).key
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
    let request = proposal
    if (existing) {
      const previous = settingsProposalSchema.parse(existing.args)
      const changes = new Map(previous.changes.map((change) => [change.id, change]))
      for (const change of proposal.changes) {
        const old = changes.get(change.id)
        changes.set(change.id, { ...change, before: old ? old.before : change.before })
      }
      request = { kind: 'settings', version: 1, changes: [...changes.values()] }
      await tx
        .update(assistantPendingActions)
        .set({ status: 'expired', disposition: 'superseded:merged' })
        .where(
          and(
            eq(assistantPendingActions.id, existing.id),
            eq(assistantPendingActions.status, 'proposed')
          )
        )
    }
    const row = await insertSettingsRequest(tx, key, request, idempotencyKey, filedBy)
    const filed = existing ? { ...row, supersededId: existing.id } : row
    return threadKey
      ? filed
      : { ...filed, reviewHref: await publishWorkspaceProposalReviewInTransaction(tx, actor, row) }
  })
  return resolved.preparationNotes.length
    ? { ...result, preparationNotes: resolved.preparationNotes }
    : result
}

async function insertSettingsRequest(
  tx: Transaction,
  threadKey: string,
  proposal: SettingsProposal,
  idempotencyKey: string,
  requester: ApprovalRequester
): Promise<AssistantPendingAction> {
  const args = proposal as unknown as Record<string, unknown>
  const [row] = await tx
    .insert(assistantPendingActions)
    .values({
      workspaceThreadKey: threadKey,
      toolName: SETTINGS_PROPOSAL_TOOL,
      args,
      summary: summarizeSettingsProposal(proposal),
      originRole: 'workspace_assistant',
      idempotencyKey,
      expiresAt: new Date(Date.now() + SETTINGS_REQUEST_TTL_MS),
      risk: settingsProposalRisk(proposal),
      argsDigest: approvalContentDigest(args),
      ...requesterColumns(requester),
    })
    .returning()
  return row
}

/** A settings request, locked for a decision. */
async function lockedSettingsRequest(
  id: AssistantPendingActionId,
  tx: Transaction
): Promise<AssistantPendingAction> {
  const row = await lockApprovalForDecision(id, tx)
  if (row.toolName !== SETTINGS_PROPOSAL_TOOL || !isDecidableApproval(row))
    throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
  return row
}

async function audit(
  tx: Transaction,
  actor: Actor,
  event: 'copilot.settings.applied' | 'copilot.settings.undone' | 'settings.undone',
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
    metadata: {
      via: 'copilot',
      principalId: actor.principalId,
      ...(event === 'settings.undone'
        ? { area: changes[0]?.area, areas: [...new Set(changes.map((change) => change.area))] }
        : {}),
    },
  })
}

/**
 * Approve a settings request and apply the selected changes, in one
 * transaction. Any person who holds every permission the request needs may
 * do this, not only whoever owns the thread; the decision names the content
 * digest the person was shown.
 */
export async function applyWorkspaceSettingsProposal(
  actor: Actor,
  id: AssistantPendingActionId,
  selectedChangeIds: string[],
  decision: ApprovalDecisionInput
): Promise<AssistantPendingAction> {
  const result = await db.transaction(async (tx) => {
    const pending = await lockedSettingsRequest(id, tx)
    assertStillPending(pending)
    const proposal = settingsProposalSchema.parse(pending.args)
    await assertMayDecide(
      pending,
      actor,
      decision,
      settingsProposalPermissions(proposal.changes),
      'approved',
      tx
    )
    const decided = await decidePendingAction(id, 'approved', actor.principalId!, tx, {
      via: decision.via ?? 'app',
      contentHash: decision.contentHash,
    })
    if (!decided)
      throw new ConflictError(
        'PENDING_ACTION_NOT_DECIDABLE',
        'This request was already decided or has expired'
      )
    const receipt = await applySettingsChangesInTransaction(tx, actor, proposal, selectedChangeIds)
    await audit(tx, actor, 'copilot.settings.applied', pending.id, receipt.changes)
    const executed = await markPendingActionExecuted(
      id,
      receipt as unknown as Record<string, unknown>,
      tx
    )
    if (!executed)
      throw new ConflictError(
        'PENDING_ACTION_NOT_DECIDABLE',
        'This request was already decided or has expired'
      )
    return executed
  })
  await invalidateSettingsCache()
  return result
}

/**
 * Undo an applied settings request while its values have not moved. Open to
 * any person who holds the permissions the change needs; they are checked
 * again on every change restored.
 */
export async function undoWorkspaceSettingsProposal(
  actor: Actor,
  id: AssistantPendingActionId,
  /** `settings.undone` when the settings registry undoes it, so the row names the area. */
  event: 'copilot.settings.undone' | 'settings.undone' = 'copilot.settings.undone'
): Promise<AssistantPendingAction> {
  const result = await db.transaction(async (tx) => {
    const pending = await lockedSettingsRequest(id, tx)
    if (pending.status !== 'executed' || !pending.result || pending.result.undoneAt)
      throw new ConflictError('SETTINGS_UNDO_UNAVAILABLE', 'This change cannot be undone')
    const receipt = pending.result as unknown as SettingsApplyReceipt
    await undoSettingsChangesInTransaction(tx, actor, receipt)
    await audit(
      tx,
      actor,
      event,
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
