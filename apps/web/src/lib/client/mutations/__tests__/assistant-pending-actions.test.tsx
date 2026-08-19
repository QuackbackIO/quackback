// @vitest-environment happy-dom
/**
 * Tests for useApproveAssistantAction / useRejectAssistantAction — thin
 * wrappers over the committed approve/reject server fns. Pins the contract
 * PendingActionCard relies on: post the id, seed the pending-action detail
 * cache with the settled row, and invalidate the settled row's own
 * conversation thread (mirrors ticket-mutations.test.ts's pattern).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AssistantPendingActionId, ConversationId } from '@quackback/ids'
import type { AssistantPendingActionDTO } from '@/lib/server/functions/assistant-actions'

const { settledDTO, approveAssistantActionFn, rejectAssistantActionFn } = vi.hoisted(() => {
  const settledDTO = {
    id: 'assistant_action_1',
    conversationId: 'conversation_1',
    involvementId: null,
    toolName: 'close_conversation',
    args: {},
    summary: 'Close conversation',
    status: 'executed',
    proposedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-07-02T00:00:00.000Z',
    decidedById: 'principal_agent1',
    decidedAt: '2026-07-01T00:05:00.000Z',
    executedAt: '2026-07-01T00:05:01.000Z',
    result: null,
  }
  return {
    settledDTO,
    approveAssistantActionFn: vi.fn(async () => settledDTO),
    rejectAssistantActionFn: vi.fn(async () => ({ ...settledDTO, status: 'rejected' })),
  }
})

vi.mock('@/lib/server/functions/assistant-actions', () => ({
  approveAssistantActionFn,
  rejectAssistantActionFn,
}))

import { useApproveAssistantAction, useRejectAssistantAction } from '../assistant-pending-actions'
import { assistantPendingActionKeys } from '@/lib/client/queries/assistant-pending-actions'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'

const PENDING_ACTION_ID = 'assistant_action_1' as AssistantPendingActionId
const CONVERSATION_ID = 'conversation_1' as ConversationId

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useApproveAssistantAction', () => {
  beforeEach(() => approveAssistantActionFn.mockClear())

  it('posts the pending action id, seeds the detail cache, and invalidates the thread', async () => {
    const client = new QueryClient()
    // Simulate the thread already being open (loaded) when the card decides.
    client.setQueryData(conversationKeys.agentThread(CONVERSATION_ID), { seeded: true })

    const { result } = renderHook(() => useApproveAssistantAction(), { wrapper: wrapper(client) })
    result.current.mutate({ pendingActionId: PENDING_ACTION_ID })

    await waitFor(() =>
      expect(approveAssistantActionFn).toHaveBeenCalledWith({
        data: { pendingActionId: PENDING_ACTION_ID },
      })
    )
    await waitFor(() =>
      expect(client.getQueryData(assistantPendingActionKeys.detail(PENDING_ACTION_ID))).toEqual(
        settledDTO as unknown as AssistantPendingActionDTO
      )
    )
    await waitFor(() =>
      expect(client.getQueryState(conversationKeys.agentThread(CONVERSATION_ID))?.isInvalidated).toBe(
        true
      )
    )
  })
})

describe('useRejectAssistantAction', () => {
  beforeEach(() => rejectAssistantActionFn.mockClear())

  it('posts the pending action id and seeds the detail cache with the rejected row', async () => {
    const client = new QueryClient()

    const { result } = renderHook(() => useRejectAssistantAction(), { wrapper: wrapper(client) })
    result.current.mutate({ pendingActionId: PENDING_ACTION_ID })

    await waitFor(() =>
      expect(rejectAssistantActionFn).toHaveBeenCalledWith({
        data: { pendingActionId: PENDING_ACTION_ID },
      })
    )
    await waitFor(() =>
      expect(client.getQueryData(assistantPendingActionKeys.detail(PENDING_ACTION_ID))).toEqual({
        ...settledDTO,
        status: 'rejected',
      })
    )
  })
})
