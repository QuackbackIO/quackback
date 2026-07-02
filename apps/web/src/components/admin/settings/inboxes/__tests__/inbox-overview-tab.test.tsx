// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InboxOverviewTab } from '../inbox-overview-tab'

type MutationOptions = {
  mutationFn: () => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateInboxFn: vi.fn(),
  archiveInboxFn: vi.fn(),
  unarchiveInboxFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: (options: MutationOptions) => ({
    isPending: false,
    mutate: async () => {
      try {
        const result = await options.mutationFn()
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
    disabled,
    onClick,
    type = 'button',
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    value,
    onChange,
    placeholder,
    disabled,
    readOnly,
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    disabled?: boolean
    readOnly?: boolean
    required?: boolean
    maxLength?: number
    className?: string
  }) => (
    <input
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
    />
  ),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
    rows?: number
  }) => <textarea id={id} value={value} onChange={onChange} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
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

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('team_primary')}>
        Pick primary team
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear primary team
      </button>
    </>
  ),
}))

vi.mock('@/components/admin/shared/status-picker', () => ({
  StatusPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onValueChange('ticket_status_default')}>
        Pick default status
      </button>
      <button type="button" onClick={() => onValueChange(null)}>
        Clear default status
      </button>
    </>
  ),
}))

vi.mock('@/lib/server/functions/inboxes', () => ({
  updateInboxFn: mocks.updateInboxFn,
  archiveInboxFn: mocks.archiveInboxFn,
  unarchiveInboxFn: mocks.unarchiveInboxFn,
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    detail: (inboxId: string) => ({ queryKey: ['inboxes', inboxId, 'detail'] }),
    list: () => ({ queryKey: ['inboxes', 'list'] }),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function inbox(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inbox_1',
    slug: 'support',
    name: 'Support inbox',
    description: 'Customer questions',
    primaryTeamId: null,
    defaultStatusId: null,
    defaultVisibilityScope: 'team',
    defaultPriority: 'normal',
    color: null,
    icon: null,
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateInboxFn.mockResolvedValue({ id: 'inbox_1' })
  mocks.archiveInboxFn.mockResolvedValue({ id: 'inbox_1' })
  mocks.unarchiveInboxFn.mockResolvedValue({ id: 'inbox_1' })
})

describe('InboxOverviewTab', () => {
  it('validates and saves normalized inbox overview settings', async () => {
    render(<InboxOverviewTab inbox={inbox() as never} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Name is required')

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Priority support  ' },
    })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  Handles urgent cases  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick primary team' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick default status' }))
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'shared' } })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'urgent' } })
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: ' #22c55e ' } })
    fireEvent.change(screen.getByLabelText('Icon'), { target: { value: ' InboxIcon ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateInboxFn).toHaveBeenCalledWith({
        data: {
          inboxId: 'inbox_1',
          name: 'Priority support',
          description: 'Handles urgent cases',
          primaryTeamId: 'team_primary',
          defaultStatusId: 'ticket_status_default',
          defaultVisibilityScope: 'shared',
          defaultPriority: 'urgent',
          color: '#22c55e',
          icon: 'InboxIcon',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['inboxes', 'inbox_1', 'detail'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inboxes', 'list'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inboxes'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Inbox updated')
  })

  it('saves nullable fields and reports update errors', async () => {
    mocks.updateInboxFn.mockRejectedValueOnce(new Error('Update failed'))
    render(
      <InboxOverviewTab
        inbox={
          inbox({
            description: null,
            primaryTeamId: 'team_old',
            defaultStatusId: 'ticket_status_old',
            color: '#000000',
            icon: 'OldIcon',
          }) as never
        }
      />
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Support' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear primary team' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear default status' }))
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Icon'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateInboxFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
            primaryTeamId: null,
            defaultStatusId: null,
            color: null,
            icon: null,
          }),
        })
      )
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Update failed')
  })

  it('archives active inboxes and unarchives archived inboxes', async () => {
    const { rerender } = render(<InboxOverviewTab inbox={inbox() as never} />)

    expect(screen.getByText(/Hide this inbox from queues/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(mocks.archiveInboxFn).toHaveBeenCalledWith({ data: { inboxId: 'inbox_1' } })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Inbox archived')

    rerender(
      <InboxOverviewTab inbox={inbox({ archivedAt: '2026-06-19T10:00:00.000Z' }) as never} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }))

    await waitFor(() => {
      expect(mocks.unarchiveInboxFn).toHaveBeenCalledWith({ data: { inboxId: 'inbox_1' } })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Inbox unarchived')
  })

  it('resets local form state when the inbox prop changes and reports archive errors', async () => {
    mocks.archiveInboxFn.mockRejectedValueOnce(new Error('Archive failed'))
    const { rerender } = render(<InboxOverviewTab inbox={inbox() as never} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved name' } })
    rerender(
      <InboxOverviewTab
        inbox={inbox({ id: 'inbox_2', slug: 'sales', name: 'Sales inbox' }) as never}
      />
    )

    expect(screen.getByLabelText('Name')).toHaveValue('Sales inbox')
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(mocks.archiveInboxFn).toHaveBeenCalledWith({ data: { inboxId: 'inbox_2' } })
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Archive failed')
  })
})
