/**
 * Shared fixtures for the assistant tool pipeline tests: one tool-context
 * builder and one pending-action row, so a context or schema field change
 * lands in a single place instead of per-file copies.
 */
import {
  makeAssistantToolContext,
  type AssistantToolContext,
} from '../assistant.toolspec'
import type { AssistantPendingAction } from '../pending-actions.service'

/** A tool context with test defaults; overrides win (including `actor`). */
export function makeToolTestContext(
  overrides: Partial<AssistantToolContext> = {}
): AssistantToolContext {
  const base = makeAssistantToolContext({
    db: {} as never,
    assistantPrincipalId: 'principal_assistant' as never,
    audience: 'public',
    conversationId: null,
    simulate: false,
  })
  return { ...base, ...overrides }
}

/** A pending-action row in its `proposed` state; override `status` etc. as needed. */
export function fakePendingActionRow(
  overrides: Partial<Record<string, unknown>> = {}
): AssistantPendingAction {
  return {
    id: 'assistant_action_1',
    conversationId: 'conversation_1',
    involvementId: 'assistant_involvement_1',
    toolName: 'close_conversation',
    args: { reason: 'resolved' },
    summary: 'Close conversation: resolved',
    status: 'proposed',
    proposedAt: new Date('2026-07-01T00:00:00.000Z'),
    expiresAt: new Date(Date.now() + 60_000),
    decidedById: null,
    decidedAt: null,
    executedAt: null,
    result: null,
    ...overrides,
  } as unknown as AssistantPendingAction
}
