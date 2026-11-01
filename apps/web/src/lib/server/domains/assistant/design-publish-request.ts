/**
 * Publishing the portal design for an agent. An agent edits the draft freely,
 * but never publishes: asking to publish files an approval that lists the
 * draft's changes. A person who may edit branding approves it, and exactly
 * the draft they were shown goes live; a draft that moved since is refused.
 */
import type { AssistantPendingActionId } from '@quackback/ids'
import { and, assistantPendingActions, db, eq } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import { designChanges } from '@/lib/shared/design/diff'
import { changeLabel } from '@/lib/shared/design/labels'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { readDesignForEditing } from '@/lib/server/domains/design/design.actions'
import {
  draftDigest,
  getDesignState,
  publishDraftInTransaction,
} from '@/lib/server/domains/design/design.service'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import {
  DESIGN_PUBLISH_PERMISSIONS,
  DESIGN_PUBLISH_TOOL,
  designPublishArgsSchema,
  summarizeDesignPublish,
  type DesignPublishArgs,
} from './approval-policy'
import {
  approvalContentDigest,
  assertMayDecide,
  assertStillPending,
  lockApprovalForDecision,
  requesterColumns,
  type ApprovalDecisionInput,
  type ApprovalRequester,
} from './approvals.service'
import {
  decidePendingAction,
  emitApprovalRequested,
  markPendingActionExecuted,
  type AssistantPendingAction,
} from './pending-actions.service'

/** A person has a week to decide; the draft may move before then, which refuses the request. */
const DESIGN_PUBLISH_TTL_MS = 7 * 24 * 60 * 60 * 1000

type Leaf = DesignPublishArgs['changes'][number]['before']
const isLeaf = (value: unknown): value is Leaf =>
  value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)

/**
 * The draft's changes as a person reads them: one row per field, and one row
 * for text edited in place, such as the welcome message, whose value is not a
 * single line.
 */
function changeRows(live: unknown, draft: unknown): DesignPublishArgs['changes'] {
  const rows = new Map<string, DesignPublishArgs['changes'][number]>()
  for (const change of designChanges(live, draft)) {
    const label = changeLabel(change.path)
    if (isLeaf(change.before) && isLeaf(change.after) && !rows.has(label)) {
      rows.set(label, {
        path: change.path,
        label,
        before: (change.before ?? null) as Leaf,
        after: (change.after ?? null) as Leaf,
      })
    } else if (!rows.has(label)) {
      rows.set(label, { path: change.path, label, before: null, after: 'Edited' })
    }
  }
  return [...rows.values()]
}

export type DesignPublishRefusal = {
  ok: false
  code: 'NO_DRAFT' | 'UNREADABLE_DESIGN'
  message: string
}

/**
 * Files a request to publish the draft as it is now, or returns the request
 * already waiting for this same draft.
 */
export async function requestDesignPublish(
  requester: ApprovalRequester
): Promise<{ ok: true; request: AssistantPendingAction } | DesignPublishRefusal> {
  const state = await getDesignState()
  if (!state?.draft)
    return {
      ok: false,
      code: 'NO_DRAFT',
      message: 'There is no draft to publish. Change the draft first.',
    }
  const errors = resolveDesign(state.draft).errors
  if (errors.length > 0) return { ok: false, code: 'UNREADABLE_DESIGN', message: errors.join('; ') }

  const digest = draftDigest(state.draft)
  const idempotencyKey = `${DESIGN_PUBLISH_TOOL}:${digest}`
  const { live } = await readDesignForEditing()
  const args: DesignPublishArgs = {
    draft: digest,
    changes: changeRows(live, state.draft),
  }
  const request = await db.transaction(async (tx) => {
    const [waiting] = await tx
      .select()
      .from(assistantPendingActions)
      .where(
        and(
          eq(assistantPendingActions.idempotencyKey, idempotencyKey),
          eq(assistantPendingActions.status, 'proposed')
        )
      )
      .limit(1)
    if (waiting) return waiting
    const stored = args as unknown as Record<string, unknown>
    const [row] = await tx
      .insert(assistantPendingActions)
      .values({
        toolName: DESIGN_PUBLISH_TOOL,
        args: stored,
        summary: summarizeDesignPublish(args),
        originRole: 'workspace_assistant',
        idempotencyKey,
        expiresAt: new Date(Date.now() + DESIGN_PUBLISH_TTL_MS),
        risk: 'medium',
        argsDigest: approvalContentDigest(stored),
        ...requesterColumns(requester),
      })
      .returning()
    await emitApprovalRequested(tx, row)
    return row
  })
  return { ok: true, request }
}

/**
 * Approves a design publish and publishes the draft it names, in one
 * transaction, as the person who approved it.
 */
export async function approveDesignPublish(
  actor: Actor,
  id: AssistantPendingActionId,
  decision: ApprovalDecisionInput
): Promise<AssistantPendingAction> {
  const result = await db.transaction(async (tx) => {
    const row = await lockApprovalForDecision(id, tx)
    if (row.toolName !== DESIGN_PUBLISH_TOOL)
      throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
    assertStillPending(row)
    const args = designPublishArgsSchema.parse(row.args)
    await assertMayDecide(row, actor, decision, DESIGN_PUBLISH_PERMISSIONS, 'approved', tx)
    const decided = await decidePendingAction(id, 'approved', actor.principalId!, tx, {
      via: decision.via ?? 'app',
      contentHash: decision.contentHash,
    })
    if (!decided)
      throw new ConflictError(
        'PENDING_ACTION_NOT_DECIDABLE',
        'This request was already decided or has expired'
      )
    const published = await publishDraftInTransaction(tx, {
      principalId: actor.principalId!,
      actor: { role: actor.role, type: 'user' },
      source: row.requestedVia === 'mcp' ? 'mcp' : 'ai',
      expectedDraft: args.draft,
    })
    const executed = await markPendingActionExecuted(id, { ...published }, tx)
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
