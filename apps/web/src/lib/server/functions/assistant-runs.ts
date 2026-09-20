/**
 * The run inspector and its recovery controls (QUINN-PRODUCT Step 11, P8).
 *
 * Authorization is the same shape the pending-action reads use, for the same
 * reason: a run is not a thing a teammate has a permission for, it is a record
 * about a conversation or a ticket, and the authority to read it is the
 * authority to view that item. So the base gate says "an inbox teammate" and
 * every read then asserts the caller can view the run's REAL parent, read off
 * the row rather than supplied by the client. A run whose parent is invisible
 * reads as one that does not exist.
 *
 * The two controls are writes and ask for more: `conversation.reply` is the
 * authority to take a conversation over, which is exactly what cancelling
 * Quinn's turn or re-running it amounts to. Neither replays arbitrary work:
 * cancel only moves an unfinished run, and the retry is refused for a run that
 * is not failed, that took an action, whose conversation has closed or been
 * taken over, or that has already been re-run once.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantRunId, ConversationId, TicketId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { assertTicketVisible } from '@/lib/server/domains/tickets/ticket.service'
import {
  findAssistantRunParent,
  getAssistantRunInspection,
  listAssistantRunsForConversation,
  listAssistantRunsForTicket,
  type AssistantRunDetail,
  type AssistantRunSummary,
} from '@/lib/server/domains/assistant/run-inspection'
import {
  cancelAssistantRun,
  retryFailedAssistantRun,
} from '@/lib/server/domains/assistant/assistant-recovery'

const ParentInput = z
  .object({
    conversationId: z.string().optional(),
    ticketId: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .refine((value) => !!value.conversationId !== !!value.ticketId, {
    message: 'Name exactly one parent',
  })

const RunInput = z.object({ runId: z.string().min(1) })

/** The one place a run's parent is checked. Everything else calls it. */
async function assertRunParentViewable(
  parent: { conversationId: string | null; ticketId: string | null },
  actor: Awaited<ReturnType<typeof policyActorFromAuth>>
): Promise<void> {
  if (parent.conversationId) {
    await assertConversationViewable(parent.conversationId as ConversationId, actor)
    return
  }
  if (parent.ticketId) {
    await assertTicketVisible(parent.ticketId as TicketId, actor)
    return
  }
  // A run with no viewable parent (a workspace thread) has no inbox item to
  // authorize against, so nothing may read it here.
  throw new NotFoundError('ASSISTANT_RUN_NOT_FOUND', 'Run not found')
}

export const listAssistantRunsFn = createServerFn({ method: 'GET' })
  .validator(ParentInput)
  .handler(async ({ data }): Promise<AssistantRunSummary[]> => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const actor = await policyActorFromAuth(auth)
    if (data.conversationId) {
      await assertConversationViewable(data.conversationId as ConversationId, actor)
      return listAssistantRunsForConversation(data.conversationId as ConversationId, data.limit)
    }
    await assertTicketVisible(data.ticketId as TicketId, actor)
    return listAssistantRunsForTicket(data.ticketId as TicketId, data.limit)
  })

export const getAssistantRunFn = createServerFn({ method: 'GET' })
  .validator(RunInput)
  .handler(async ({ data }): Promise<AssistantRunDetail> => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const actor = await policyActorFromAuth(auth)
    const parent = await findAssistantRunParent(data.runId as AssistantRunId)
    if (!parent) throw new NotFoundError('ASSISTANT_RUN_NOT_FOUND', 'Run not found')
    await assertRunParentViewable(parent, actor)
    const detail = await getAssistantRunInspection(data.runId as AssistantRunId)
    if (!detail) throw new NotFoundError('ASSISTANT_RUN_NOT_FOUND', 'Run not found')
    return detail
  })

export const cancelAssistantRunFn = createServerFn({ method: 'POST' })
  .validator(RunInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
    const actor = await policyActorFromAuth(auth)
    const parent = await findAssistantRunParent(data.runId as AssistantRunId)
    if (!parent) throw new NotFoundError('ASSISTANT_RUN_NOT_FOUND', 'Run not found')
    await assertRunParentViewable(parent, actor)
    const run = await cancelAssistantRun(data.runId as AssistantRunId)
    return { id: run.id, status: run.status, disposition: run.disposition }
  })

export const retryAssistantRunFn = createServerFn({ method: 'POST' })
  .validator(RunInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
    const actor = await policyActorFromAuth(auth)
    const parent = await findAssistantRunParent(data.runId as AssistantRunId)
    if (!parent) throw new NotFoundError('ASSISTANT_RUN_NOT_FOUND', 'Run not found')
    if (!parent.conversationId) {
      throw new ValidationError('VALIDATION_ERROR', 'Only a conversation turn can be run again')
    }
    await assertRunParentViewable(parent, actor)
    const run = await retryFailedAssistantRun(data.runId as AssistantRunId, {
      requestedByPrincipalId: auth.principal.id,
    })
    return { id: run.id, status: run.status }
  })
