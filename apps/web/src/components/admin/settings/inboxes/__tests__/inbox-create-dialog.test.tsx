// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InboxCreateDialog } from '../inbox-create-dialog'

type MutationOptions<T> = {
  mutationFn: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  createInboxFn: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: <T,>(options: MutationOptions<T>) => ({
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

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: mocks.navigate,
  }),
}))

vi.mock('@/components/ui/dialog', () => {
  let openDialog: (open: boolean) => void = () => undefined
  let currentOpen = false

  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children: ReactNode
    }) => {
      currentOpen = open
      openDialog = onOpenChange
      return <div>{children}</div>
    },
    DialogTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => (
      <button type="button" onClick={() => openDialog(true)}>
        {children}
      </button>
    ),
    DialogContent: ({ children }: { children: ReactNode; className?: string }) =>
      currentOpen ? <section role="dialog">{children}</section> : null,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
    DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  }
})

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
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    required?: boolean
    maxLength?: number
  }) => <input id={id} value={value} onChange={onChange} placeholder={placeholder} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    rows,
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
    rows?: number
  }) => <textarea id={id} value={value} onChange={onChange} rows={rows} />,
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
    <select
      aria-label={`select-${value}`}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
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

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    allowClear?: boolean
    placeholder?: string
  }) => (
    <select
      aria-label="Primary team"
      value={value ?? ''}
      onChange={(event) => onValueChange(event.currentTarget.value || null)}
    >
      <option value="">{placeholder ?? 'No team'}</option>
      <option value="team_support">Support</option>
      <option value="team_success">Success</option>
    </select>
  ),
}))

vi.mock('@/components/admin/shared/status-picker', () => ({
  StatusPicker: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    placeholder?: string
  }) => (
    <select
      aria-label="Default status"
      value={value ?? ''}
      onChange={(event) => onValueChange(event.currentTarget.value || null)}
    >
      <option value="">{placeholder ?? 'Workspace default'}</option>
      <option value="status_open">Open</option>
      <option value="status_triage">Triage</option>
    </select>
  ),
}))

vi.mock('@/lib/server/functions/inboxes', () => ({
  createInboxFn: mocks.createInboxFn,
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    list: () => ({ queryKey: ['inboxes', 'list'] }),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function renderDialog() {
  return render(<InboxCreateDialog trigger={<span>Open inbox dialog</span>} />)
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Open inbox dialog' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createInboxFn.mockResolvedValue({ id: 'inbox_created' })
})

describe('InboxCreateDialog', () => {
  it('opens from the trigger and validates required slug and name fields', () => {
    renderDialog()
    expect(screen.queryByRole('heading', { name: 'New inbox' })).not.toBeInTheDocument()

    openDialog()

    expect(screen.getByRole('heading', { name: 'New inbox' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create inbox' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Slug and name are required')
    expect(mocks.createInboxFn).not.toHaveBeenCalled()
  })

  it('creates an inbox with trimmed defaults, invalidates inbox lists and navigates to detail', async () => {
    renderDialog()
    openDialog()

    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'SUPPORT' } })
    expect(screen.getByLabelText('Slug')).toHaveValue('support')
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Customer Support  ' },
    })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  All customer requests  ' },
    })
    fireEvent.change(screen.getByLabelText('Primary team'), {
      target: { value: 'team_support' },
    })
    fireEvent.change(screen.getByLabelText('select-team'), { target: { value: 'shared' } })
    fireEvent.change(screen.getByLabelText('select-normal'), { target: { value: 'urgent' } })
    fireEvent.change(screen.getByLabelText('Default status'), {
      target: { value: 'status_triage' },
    })
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '  #22c55e  ' } })
    fireEvent.change(screen.getByLabelText('Icon'), { target: { value: '  InboxIcon  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create inbox' }))

    await waitFor(() => {
      expect(mocks.createInboxFn).toHaveBeenCalledWith({
        data: {
          slug: 'support',
          name: 'Customer Support',
          description: 'All customer requests',
          primaryTeamId: 'team_support',
          defaultStatusId: 'status_triage',
          defaultVisibilityScope: 'shared',
          defaultPriority: 'urgent',
          color: '#22c55e',
          icon: 'InboxIcon',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['inboxes', 'list'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inboxes'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Inbox created')
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/settings/inboxes/$inboxId',
      params: { inboxId: 'inbox_created' },
    })
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'New inbox' })).not.toBeInTheDocument()
    })

    openDialog()
    expect(screen.getByLabelText('Slug')).toHaveValue('')
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Description')).toHaveValue('')
    expect(screen.getByLabelText('Primary team')).toHaveValue('')
    expect(screen.getByLabelText('Default status')).toHaveValue('')
    expect(screen.getByLabelText('select-team')).toHaveValue('team')
    expect(screen.getByLabelText('select-normal')).toHaveValue('normal')
  })

  it('submits nullable optional fields and keeps the dialog open when creation fails', async () => {
    mocks.createInboxFn.mockRejectedValueOnce(new Error('Slug already exists'))

    renderDialog()
    openDialog()

    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'OPS' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Operations  ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Icon'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create inbox' }))

    await waitFor(() => {
      expect(mocks.createInboxFn).toHaveBeenCalledWith({
        data: {
          slug: 'ops',
          name: 'Operations',
          description: null,
          primaryTeamId: null,
          defaultStatusId: null,
          defaultVisibilityScope: 'team',
          defaultPriority: 'normal',
          color: null,
          icon: null,
        },
      })
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Slug already exists')
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'New inbox' })).toBeInTheDocument()
  })

  it('closes the dialog without submitting when cancelled', () => {
    renderDialog()
    openDialog()

    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'support' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocks.createInboxFn).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'New inbox' })).not.toBeInTheDocument()
  })
})
