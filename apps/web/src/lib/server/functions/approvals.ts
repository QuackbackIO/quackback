/**
 * Approvals: the queue of requests a person may decide, the ones decided, one
 * request with its diff, what waits on the person (the rail's count and
 * Home's list), approving or turning one down, and reading the approval bell.
 *
 * The base gate is a signed-in session; who may see or decide each request is
 * per row (the item's visibility and every permission the operation needs),
 * enforced by the approvals services. A decision that arrives here comes from
 * a person's session, never from the credential that filed the request, and
 * names the digest of the request the person was shown. A refusal the page
 * can act on is returned as `{ ok: false, code, message }`.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId, type AssistantPendingActionId } from '@quackback/ids'
import type { ApprovalView } from '@/lib/server/domains/assistant/approvals.queue'
import { approvalRefusal, type ApprovalRefusal } from '@/lib/shared/approval-refusal'
import { requireAuth, policyActorFromAuth } from './auth-helpers'

const ApprovalInput = z.object({ approvalId: z.string() })
/** A decision always names the digest of the request it was shown. */
const DecisionInput = ApprovalInput.extend({ contentHash: z.string().min(1).max(128) })

/** A decision's outcome: the request as it now stands, or why it was refused. */
export type ApprovalDecisionResult = { ok: true; approval: ApprovalView } | ApprovalRefusal

export const listApprovalsFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      limit: z.number().int().min(1).max(100).optional(),
      view: z.enum(['waiting', 'decided']).optional(),
      /** Where the next page starts: the id of the last request the previous one read. */
      cursor: z
        .string()
        .refine((value) => isValidTypeId(value, 'assistant_action'))
        .optional(),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    const actor = await policyActorFromAuth(auth)
    const { pageApprovalsForViewer } =
      await import('@/lib/server/domains/assistant/approvals.queue')
    return pageApprovalsForViewer(actor, {
      view: data.view ?? 'waiting',
      limit: data.limit,
      cursor: data.cursor,
    })
  })

export const getApprovalFn = createServerFn({ method: 'GET' })
  .validator(ApprovalInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    const actor = await policyActorFromAuth(auth)
    const { getApprovalForViewer } = await import('@/lib/server/domains/assistant/approvals.queue')
    return getApprovalForViewer(actor, data.approvalId as AssistantPendingActionId)
  })

async function approveAsPerson(
  data: z.infer<typeof DecisionInput>,
  auth: Awaited<ReturnType<typeof requireAuth>>,
  actor: Awaited<ReturnType<typeof policyActorFromAuth>>,
  via: 'app' | 'email'
): Promise<ApprovalDecisionResult> {
  const id = data.approvalId as AssistantPendingActionId
  const { approveApproval } = await import('@/lib/server/domains/assistant/approvals.service')
  const { approvalViewOf } = await import('@/lib/server/domains/assistant/approvals.queue')
  // Only the server answers whether the person signed in just now, from
  // their own session; a high-risk request is refused without it.
  const { hasRecentSignIn } = await import('@/lib/server/auth/recent-sign-in')
  let settled
  try {
    settled = await approveApproval(actor, id, {
      contentHash: data.contentHash,
      via,
      freshSignIn: await hasRecentSignIn(auth),
    })
  } catch (error) {
    // A refusal the page branches on travels as a value; see approvalRefusal.
    const refused = approvalRefusal(error)
    if (refused) return refused
    throw error
  }
  // The answer is the request as the decision left it; see approvalViewOf.
  return { ok: true, approval: await approvalViewOf(settled) }
}

export const approveApprovalFn = createServerFn({ method: 'POST' })
  .validator(DecisionInput)
  .handler(async ({ data }): Promise<ApprovalDecisionResult> => {
    const auth = await requireAuth()
    const actor = await policyActorFromAuth(auth)
    return approveAsPerson(data, auth, actor, 'app')
  })

export const approveApprovalFromEmailFn = createServerFn({ method: 'POST' })
  .validator(DecisionInput)
  .handler(async ({ data }): Promise<ApprovalDecisionResult> => {
    const auth = await requireAuth()
    const actor = await policyActorFromAuth(auth)
    return approveAsPerson(data, auth, actor, 'email')
  })

export const rejectApprovalFn = createServerFn({ method: 'POST' })
  .validator(DecisionInput.extend({ reason: z.string().max(500).optional() }))
  .handler(async ({ data }): Promise<ApprovalDecisionResult> => {
    const auth = await requireAuth()
    const actor = await policyActorFromAuth(auth)
    const id = data.approvalId as AssistantPendingActionId
    const { rejectApproval } = await import('@/lib/server/domains/assistant/approvals.service')
    const { approvalViewOf } = await import('@/lib/server/domains/assistant/approvals.queue')
    let settled
    try {
      settled = await rejectApproval(actor, id, {
        contentHash: data.contentHash,
        reason: data.reason,
        via: 'app',
      })
    } catch (error) {
      const refused = approvalRefusal(error)
      if (refused) return refused
      throw error
    }
    return { ok: true, approval: await approvalViewOf(settled) }
  })

/**
 * Read the caller's own unread approval bell, for the approvals queue to call
 * when it opens: the bell counts requests since it was last read, and the
 * next one starts a new count. Acts only on the caller's own notifications.
 */
export const markApprovalBellReadFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ marked: number }> => {
    const auth = await requireAuth()
    const { markApprovalBellsRead } =
      await import('@/lib/server/domains/notifications/notification.service')
    return { marked: await markApprovalBellsRead(auth.principal.id) }
  }
)
