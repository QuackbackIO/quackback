// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CONNECTOR_RESPONSE_CHAR_LIMIT } from '@/lib/shared/assistant/connectors'
import type { CopilotProposedAction } from '@/lib/shared/assistant/copilot-contract'

const mocks = vi.hoisted(() => ({ usePendingActionDecision: vi.fn() }))
vi.mock('@/lib/client/hooks/use-pending-action-decision', () => mocks)

import { CopilotProposedActionCard } from '../copilot-proposed-action-card'

const action: CopilotProposedAction = {
  id: 'assistant_action_1',
  toolName: 'connector_crm__lookup',
  label: 'Find customer',
  summary: 'Read the selected customer',
  connector: { name: 'CRM', initials: 'CR' },
}

function decision(result: unknown, status = 'executed', toolName = action.toolName) {
  const value = {
    data: { status, toolName, result },
    isLoading: false,
    isError: false,
    busy: false,
    approving: false,
    rejecting: false,
    inlineError: null,
    approve: vi.fn(),
    reject: vi.fn(),
  }
  mocks.usePendingActionDecision.mockReturnValue(value)
  return value
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('Copilot approved connector result', () => {
  it('shows the stored successful result without executing the action again', () => {
    decision({ ok: true, data: 'Customer Jane — active subscription' })
    render(<CopilotProposedActionCard action={action} />)
    expect(screen.getByLabelText('Connector result')).toHaveTextContent(
      'Customer Jane — active subscription'
    )
    expect(screen.getByText('Approved and executed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    const hook = mocks.usePendingActionDecision.mock.results[0].value
    expect(hook.approve).not.toHaveBeenCalled()
    expect(hook.reject).not.toHaveBeenCalled()
  })

  it('shows structured data as readable plain text and keeps the connector note', () => {
    decision({
      ok: true,
      data: { customers: [{ id: 12, active: true }] },
      note: 'Result was truncated.',
    })
    render(<CopilotProposedActionCard action={action} />)
    expect(screen.getByLabelText('Connector result').textContent).toBe(
      JSON.stringify({ customers: [{ id: 12, active: true }] }, null, 2)
    )
    expect(screen.getByText('Result was truncated.')).toBeInTheDocument()
  })

  it('bounds long data and visibly explains that the preview was shortened', () => {
    decision({
      ok: true,
      data: 'START' + 'x'.repeat(CONNECTOR_RESPONSE_CHAR_LIMIT) + 'SECRET_TAIL',
    })
    render(<CopilotProposedActionCard action={action} />)
    expect(screen.getByLabelText('Connector result').textContent?.length).toBeLessThanOrEqual(
      CONNECTOR_RESPONSE_CHAR_LIMIT
    )
    expect(screen.getByText('Result preview truncated.')).toBeInTheDocument()
    expect(screen.queryByText(/SECRET_TAIL/)).not.toBeInTheDocument()
  })

  it('renders connector HTML and Markdown literally, without creating executable elements or links', () => {
    const untrusted =
      '<img src=x onerror="alert(1)"><script>alert(2)</script> [Click](javascript:alert(3))'
    decision({ ok: true, data: untrusted, note: '<b>External result</b>' })
    const { container } = render(<CopilotProposedActionCard action={action} />)
    expect(screen.getByLabelText('Connector result').textContent).toBe(untrusted)
    expect(screen.getByText('<b>External result</b>')).toBeInTheDocument()
    expect(container.querySelector('img,script,a,b')).toBeNull()
  })

  it('also bounds an oversized connector note without hiding the returned data', () => {
    decision({
      ok: true,
      data: 'Returned records',
      note: 'n'.repeat(CONNECTOR_RESPONSE_CHAR_LIMIT + 100) + 'NOTE_TAIL',
    })
    render(<CopilotProposedActionCard action={action} />)
    expect(screen.getByText('Result note truncated.')).toBeInTheDocument()
    expect(screen.queryByText(/NOTE_TAIL/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Connector result')).toHaveTextContent('Returned records')
  })

  it.each([null, false, 0])('does not discard a valid primitive result %j', (data) => {
    decision({ ok: true, data })
    render(<CopilotProposedActionCard action={action} />)
    expect(screen.getByLabelText('Connector result').textContent).toBe(JSON.stringify(data))
  })

  it.each(['isLoading', 'isError'])('does not show a cached result while %s', (state) => {
    const value = decision({ ok: true, data: 'PRIVATE_RESULT' })
    mocks.usePendingActionDecision.mockReturnValue({ ...value, [state]: true })
    render(<CopilotProposedActionCard action={action} />)
    expect(screen.queryByLabelText('Connector result')).not.toBeInTheDocument()
    expect(screen.queryByText(/PRIVATE_RESULT/)).not.toBeInTheDocument()
  })

  it.each(['proposed', 'approved', 'rejected', 'expired', 'failed'])(
    'does not show stored data for the %s state',
    (status) => {
      decision({ ok: true, data: 'PRIVATE_RESULT' }, status)
      render(<CopilotProposedActionCard action={action} />)
      expect(screen.queryByLabelText('Connector result')).not.toBeInTheDocument()
      expect(screen.queryByText(/PRIVATE_RESULT/)).not.toBeInTheDocument()
    }
  )

  it.each([{ ok: false, data: 'PRIVATE_RESULT' }, { data: 'PRIVATE_RESULT' }, null])(
    'does not expose a failed or malformed connector payload: %j',
    (result) => {
      decision(result)
      render(<CopilotProposedActionCard action={action} />)
      expect(screen.queryByLabelText('Connector result')).not.toBeInTheDocument()
      expect(screen.queryByText(/PRIVATE_RESULT/)).not.toBeInTheDocument()
    }
  )

  it('does not expose built-in action data even when proposal metadata names a connector', () => {
    decision({ ok: true, data: 'PRIVATE_RESULT', reference: 'ABC-12' }, 'executed', 'create_ticket')
    render(<CopilotProposedActionCard action={action} />)
    expect(screen.getByText('Ticket ABC-12')).toBeInTheDocument()
    expect(screen.queryByLabelText('Connector result')).not.toBeInTheDocument()
    expect(screen.queryByText(/PRIVATE_RESULT/)).not.toBeInTheDocument()
  })
})
