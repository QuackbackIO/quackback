// @vitest-environment happy-dom
/**
 * PendingActionCard: fetches the LIVE pending-action row (never trusts the
 * stale note snapshot) and only shows Approve/Reject while it's `proposed`;
 * every other status renders the terminal label instead. Approve/Reject wire
 * to the committed server fns, and a rejection (e.g. 403/409 from the
 * approval gate) surfaces inline rather than throwing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AssistantPendingActionDTO } from '@/lib/server/functions/assistant-actions'

const { getAssistantPendingActionFn, approveAssistantActionFn, rejectAssistantActionFn } =
  vi.hoisted(() => ({
    getAssistantPendingActionFn: vi.fn(),
    approveAssistantActionFn: vi.fn(),
    rejectAssistantActionFn: vi.fn(),
  }))

vi.mock('@/lib/server/functions/assistant-pending-actions', () => ({
  getAssistantPendingActionFn,
}))
vi.mock('@/lib/server/functions/assistant-actions', () => ({
  approveAssistantActionFn,
  rejectAssistantActionFn,
}))

import { PendingActionCard } from '../pending-action-card'

function pendingRow(overrides: Partial<AssistantPendingActionDTO> = {}): AssistantPendingActionDTO {
  return {
    id: 'assistant_action_1',
    conversationId: 'conversation_1',
    involvementId: null,
    toolName: 'close_conversation',
    args: {},
    summary: 'Close conversation: resolved',
    status: 'proposed',
    proposedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-07-02T00:00:00.000Z',
    decidedById: null,
    decidedAt: null,
    executedAt: null,
    result: null,
    ...overrides,
  }
}

function renderCard(props: Partial<{ pendingActionId: string; summary: string }> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PendingActionCard
        pendingActionId={props.pendingActionId ?? 'assistant_action_1'}
        summary={props.summary ?? 'Close conversation: resolved'}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<PendingActionCard>', () => {
  it('shows the summary and Approve/Reject while the live row is proposed', async () => {
    getAssistantPendingActionFn.mockResolvedValue(pendingRow())

    renderCard()

    expect(screen.getByText('Close conversation: resolved')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
  })

  it('renders the terminal label instead of buttons once the row is decided', async () => {
    getAssistantPendingActionFn.mockResolvedValue(pendingRow({ status: 'expired' }))

    renderCard()

    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('approving calls the server fn and swaps to the executed terminal state', async () => {
    getAssistantPendingActionFn.mockResolvedValue(pendingRow())
    approveAssistantActionFn.mockResolvedValue(pendingRow({ status: 'executed' }))

    renderCard()
    const approveButton = await screen.findByRole('button', { name: /approve/i })
    await userEvent.click(approveButton)

    await waitFor(() =>
      expect(approveAssistantActionFn).toHaveBeenCalledWith({
        data: { pendingActionId: 'assistant_action_1' },
      })
    )
    expect(await screen.findByText('Approved and executed')).toBeInTheDocument()
  })

  it('rejecting calls the server fn and swaps to the rejected terminal state', async () => {
    getAssistantPendingActionFn.mockResolvedValue(pendingRow())
    rejectAssistantActionFn.mockResolvedValue(pendingRow({ status: 'rejected' }))

    renderCard()
    const rejectButton = await screen.findByRole('button', { name: /reject/i })
    await userEvent.click(rejectButton)

    await waitFor(() =>
      expect(rejectAssistantActionFn).toHaveBeenCalledWith({
        data: { pendingActionId: 'assistant_action_1' },
      })
    )
    expect(await screen.findByText('Rejected')).toBeInTheDocument()
  })

  it('shows the server error inline when the approver lacks the permission (403)', async () => {
    getAssistantPendingActionFn.mockResolvedValue(pendingRow())
    approveAssistantActionFn.mockRejectedValue(
      new Error("Approving this action requires the 'conversation.set_status' permission")
    )

    renderCard()
    const approveButton = await screen.findByRole('button', { name: /approve/i })
    await userEvent.click(approveButton)

    expect(
      await screen.findByText(/requires the 'conversation.set_status' permission/)
    ).toBeInTheDocument()
    // Still proposed (server refused the decision) — buttons stay usable.
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
  })

  it('shows the server error inline when the proposal was already decided (409)', async () => {
    getAssistantPendingActionFn.mockResolvedValue(pendingRow())
    approveAssistantActionFn.mockRejectedValue(
      new Error('This request was already decided or has expired')
    )

    renderCard()
    const approveButton = await screen.findByRole('button', { name: /approve/i })
    await userEvent.click(approveButton)

    expect(await screen.findByText(/already decided or has expired/)).toBeInTheDocument()
  })
})
