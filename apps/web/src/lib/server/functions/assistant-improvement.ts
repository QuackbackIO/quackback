/**
 * The conversation-to-improvement loop (QUINN-PRODUCT Step 11, P8).
 *
 * Two ways out of a conversation that went wrong, and they answer different
 * questions. A regression case says "this must keep working", and is run
 * against every future release candidate. A guidance draft says "behave
 * differently here", and is an ordinary canonical entry created disabled, so a
 * person reviews and enables it on the Guidance page rather than a flagged
 * conversation quietly changing how Quinn speaks.
 *
 * Both are item-scoped writes, so both check the conversation the same way the
 * inbox does before they record anything. The guidance draft additionally needs
 * `assistant.manage`, because it writes to the store the runtime reads: being
 * able to see a conversation is not authority to change Quinn's instructions.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type {
  AssistantRegressionCaseId,
  ConversationId,
  ConversationMessageId,
} from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import {
  addRegressionCase,
  listRegressionCases,
  setRegressionCaseEnabled,
} from '@/lib/server/domains/assistant/regression-cases.service'
import {
  saveGuidanceEntry,
  toGuidanceEntryDTO,
} from '@/lib/server/domains/assistant/guidance-entries.service'
import { guidanceEntryInputSchema } from '@/lib/shared/assistant/guidance-entry'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { getRequestHeaders } from '@tanstack/react-start/server'

const AddCaseInput = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().optional(),
  question: z.string().min(1).max(2000),
  expectation: z.enum(['answers', 'cites_source', 'hands_off']),
  expectedSourceType: z.string().max(60).optional(),
  expectedSourceId: z.string().max(120).optional(),
  correctionNote: z.string().max(4000).optional(),
  title: z.string().max(120).optional(),
})

export const addAssistantRegressionCaseFn = createServerFn({ method: 'POST' })
  .validator(AddCaseInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
    const actor = await policyActorFromAuth(auth)
    await assertConversationViewable(data.conversationId as ConversationId, actor)
    const testCase = await addRegressionCase({
      question: data.question,
      expectation: data.expectation,
      expectedSourceType: data.expectedSourceType ?? null,
      expectedSourceId: data.expectedSourceId ?? null,
      correctionNote: data.correctionNote ?? null,
      title: data.title ?? null,
      conversationId: data.conversationId as ConversationId,
      messageId: (data.messageId as ConversationMessageId | undefined) ?? null,
      createdByPrincipalId: auth.principal.id,
      origin: 'answer_correction',
    })
    return { id: testCase.id, title: testCase.title, enabled: testCase.enabled }
  })

export const listAssistantRegressionCasesFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const rows = await listRegressionCases()
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      question: row.question,
      expectation: row.expectation,
      expectedSourceType: row.expectedSourceType,
      expectedSourceId: row.expectedSourceId,
      enabled: row.enabled,
      origin: row.origin,
      conversationId: row.conversationId,
      createdAt: row.createdAt.toISOString(),
    }))
  }
)

export const setAssistantRegressionCaseEnabledFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const row = await setRegressionCaseEnabled(data.id as AssistantRegressionCaseId, data.enabled)
    if (!row) throw new NotFoundError('ASSISTANT_REGRESSION_CASE_NOT_FOUND', 'Case not found')
    return { id: row.id, enabled: row.enabled }
  })

const GuidanceDraftInput = z.object({
  conversationId: z.string().min(1),
  entry: guidanceEntryInputSchema,
})

/**
 * Create a guidance draft from a conversation.
 *
 * The entry is forced disabled whatever the caller sent: a draft written from
 * one bad conversation is a proposal, and enabling it is a separate decision
 * made on the Guidance page with the rest of the instructions in view.
 */
export const createGuidanceDraftFromConversationFn = createServerFn({ method: 'POST' })
  .validator(GuidanceDraftInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const actor = await policyActorFromAuth(auth)
    await assertConversationViewable(data.conversationId as ConversationId, actor)
    const entry = await saveGuidanceEntry({
      entry: { ...data.entry, enabled: false },
      createdById: auth.principal.id,
      sourceConversationId: data.conversationId as ConversationId,
    })
    await recordAuditEvent({
      event: 'assistant.guidance.created',
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
      target: { type: 'assistant_guidance_entry', id: entry.id },
      after: {
        title: entry.title,
        kind: entry.kind,
        enabled: entry.enabled,
        uses: entry.uses,
        source: 'conversation',
      },
    })
    return toGuidanceEntryDTO(entry, false)
  })
