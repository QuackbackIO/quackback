// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TicketPropertiesPanel } from '../ticket-properties-panel'

type MutationOptions = {
  mutationFn: (value: unknown) => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  getQueryData: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  assignTicketFn: vi.fn(),
  transitionTicketStatusFn: vi.fn(),
  updateTicketFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: mocks.getQueryData,
    setQueryData: mocks.setQueryData,
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: (options: MutationOptions) => ({
    mutate: async (value: unknown) => {
      try {
        const result = await options.mutationFn(value)
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    type = 'button',
  }: {
    children: ReactNode
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    size?: string
    variant?: string
  }) => (
    <button type={type} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    className?: string
  }) => <input aria-label="Subject draft" value={value} onChange={onChange} />,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('principal_agent')}>
        Assign agent
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Unassign agent
      </button>
    </>
  ),
}))

vi.mock('@/components/admin/shared/status-picker', () => ({
  StatusPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('ticket_status_solved')}>
        Pick status
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear status
      </button>
    </>
  ),
}))

vi.mock('@/components/admin/shared/inbox-picker', () => ({
  InboxPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('inbox_support')}>
        Pick inbox
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear inbox
      </button>
    </>
  ),
}))

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('team_primary')}>
        Pick team
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear team
      </button>
    </>
  ),
}))

vi.mock('@/components/admin/shared/org-picker', () => ({
  OrgPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('organization_acme')}>
        Pick organization
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear organization
      </button>
    </>
  ),
}))

vi.mock('@/components/admin/shared/contact-picker', () => ({
  ContactPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('contact_requester')}>
        Pick contact
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear contact
      </button>
    </>
  ),
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  assignTicketFn: mocks.assignTicketFn,
  transitionTicketStatusFn: mocks.transitionTicketStatusFn,
  updateTicketFn: mocks.updateTicketFn,
}))

vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    detail: (ticketId: string) => ({ queryKey: ['tickets', ticketId, 'detail'] }),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket_1',
    subject: 'Original subject',
    statusId: 'ticket_status_open',
    priority: 'normal',
    visibilityScope: 'team',
    primaryTeamId: null,
    inboxId: null,
    organizationId: null,
    requesterContactId: null,
    assigneePrincipalId: null,
    updatedAt: '2026-06-19T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getQueryData.mockReturnValue({ updatedAt: '2026-06-19T10:30:00.000Z' })
  mocks.assignTicketFn.mockResolvedValue({ id: 'ticket_1', updatedAt: '2026-06-19T10:31:00.000Z' })
  mocks.transitionTicketStatusFn.mockResolvedValue({
    id: 'ticket_1',
    updatedAt: '2026-06-19T10:32:00.000Z',
  })
  mocks.updateTicketFn.mockResolvedValue({ id: 'ticket_1', updatedAt: '2026-06-19T10:33:00.000Z' })
})

describe('TicketPropertiesPanel', () => {
  it('edits and cancels the subject inline', async () => {
    render(<TicketPropertiesPanel ticket={ticket() as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Original subject' }))
    fireEvent.change(screen.getByLabelText('Subject draft'), {
      target: { value: 'Unsaved subject' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Original subject' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Original subject' }))
    fireEvent.change(screen.getByLabelText('Subject draft'), {
      target: { value: 'Updated subject' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocks.updateTicketFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_1',
          expectedUpdatedAt: '2026-06-19T10:30:00.000Z',
          subject: 'Updated subject',
        },
      })
    })
    expect(mocks.setQueryData).toHaveBeenCalledWith(['tickets', 'ticket_1', 'detail'], {
      id: 'ticket_1',
      updatedAt: '2026-06-19T10:33:00.000Z',
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'ticket_1', 'detail'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tickets', 'list'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ticket updated')
  })

  it('updates assignee and status with optimistic concurrency timestamps', async () => {
    render(<TicketPropertiesPanel ticket={ticket() as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Assign agent' }))
    await waitFor(() => {
      expect(mocks.assignTicketFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_1',
          expectedUpdatedAt: '2026-06-19T10:30:00.000Z',
          assigneePrincipalId: 'principal_agent',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Assignee updated')

    fireEvent.click(screen.getByRole('button', { name: 'Unassign agent' }))
    await waitFor(() => {
      expect(mocks.assignTicketFn).toHaveBeenLastCalledWith({
        data: {
          ticketId: 'ticket_1',
          expectedUpdatedAt: '2026-06-19T10:30:00.000Z',
          assigneePrincipalId: null,
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }))
    expect(mocks.transitionTicketStatusFn).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Pick status' }))
    await waitFor(() => {
      expect(mocks.transitionTicketStatusFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_1',
          expectedUpdatedAt: '2026-06-19T10:30:00.000Z',
          statusId: 'ticket_status_solved',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Status updated')
  })

  it('updates ticket properties from selects and pickers', async () => {
    render(<TicketPropertiesPanel ticket={ticket() as never} />)

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'urgent' } })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'private' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick inbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear team' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick organization' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear contact' }))

    await waitFor(() => {
      expect(mocks.updateTicketFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 'urgent' }),
        })
      )
    })
    expect(mocks.updateTicketFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ visibilityScope: 'private' }),
      })
    )
    expect(mocks.updateTicketFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ inboxId: 'inbox_support' }),
      })
    )
    expect(mocks.updateTicketFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ primaryTeamId: null }),
      })
    )
    expect(mocks.updateTicketFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'organization_acme' }),
      })
    )
    expect(mocks.updateTicketFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requesterContactId: null }),
      })
    )
  })

  it('falls back to the ticket timestamp and handles stale-conflict refresh actions', async () => {
    mocks.getQueryData.mockReturnValue(undefined)
    mocks.updateTicketFn.mockRejectedValueOnce(new Error('stale conflict'))
    render(<TicketPropertiesPanel ticket={ticket() as never} />)

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'high' } })

    await waitFor(() => {
      expect(mocks.updateTicketFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_1',
          expectedUpdatedAt: '2026-06-19T10:00:00.000Z',
          priority: 'high',
        },
      })
    })
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Ticket changed — refresh',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'Refresh' }),
      })
    )

    const refresh = mocks.toastError.mock.calls[0][1].action.onClick as () => void
    refresh()
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'ticket_1', 'detail'],
    })
  })

  it('reports non-conflict mutation errors', async () => {
    mocks.assignTicketFn.mockRejectedValueOnce(new Error('No permission'))
    render(<TicketPropertiesPanel ticket={ticket() as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Assign agent' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('No permission')
    })
  })
})
