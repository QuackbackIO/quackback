// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InboxChannelDialog } from '../inbox-channel-dialog'

type MutationOptions = {
  mutationFn: () => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  addInboxChannelFn: vi.fn(),
  updateInboxChannelFn: vi.fn(),
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
    type = 'text',
    value,
    onChange,
    placeholder,
  }: {
    id?: string
    type?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    required?: boolean
    maxLength?: number
    autoComplete?: string
  }) => <input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input id={id} type="checkbox" checked={checked} onChange={() => onCheckedChange(!checked)} />
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    disabled?: boolean
    children: ReactNode
  }) => (
    <select
      aria-label="Kind"
      value={value}
      disabled={disabled}
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

vi.mock('@/lib/server/functions/inboxes', () => ({
  addInboxChannelFn: mocks.addInboxChannelFn,
  updateInboxChannelFn: mocks.updateInboxChannelFn,
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    channels: (inboxId: string) => ({ queryKey: ['inboxes', inboxId, 'channels'] }),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function renderDialog(channel?: React.ComponentProps<typeof InboxChannelDialog>['channel']) {
  return render(
    <InboxChannelDialog
      inboxId={'inbox_1' as never}
      channel={channel}
      trigger={<span>Open channel dialog</span>}
    />
  )
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Open channel dialog' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.addInboxChannelFn.mockResolvedValue({ id: 'inbox_channel_new' })
  mocks.updateInboxChannelFn.mockResolvedValue({ id: 'inbox_channel_1' })
})

describe('InboxChannelDialog', () => {
  it('creates an email channel with trimmed config and invalidates channel queries', async () => {
    renderDialog()
    openDialog()

    expect(screen.getByRole('heading', { name: 'Add channel' })).toBeInTheDocument()
    expect(screen.getByText('No additional configuration required.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Label is required')

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'email' } })
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: '  Email support  ' },
    })
    fireEvent.change(screen.getByLabelText('External ID'), {
      target: { value: '  provider-123  ' },
    })
    fireEvent.change(screen.getByLabelText('Mailbox'), {
      target: { value: '  support@example.com  ' },
    })
    fireEvent.change(screen.getByLabelText('Forwarding address'), {
      target: { value: '  forward@example.com  ' },
    })
    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))

    await waitFor(() => {
      expect(mocks.addInboxChannelFn).toHaveBeenCalledWith({
        data: {
          inboxId: 'inbox_1',
          kind: 'email',
          label: 'Email support',
          externalId: 'provider-123',
          enabled: false,
          config: {
            mailbox: 'support@example.com',
            forwardingAddress: 'forward@example.com',
          },
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['inboxes', 'inbox_1', 'channels'],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Channel added')
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Add channel' })).not.toBeInTheDocument()
    })
  })

  it('creates a webhook channel with signing config and a write-only secret', async () => {
    renderDialog()
    openDialog()

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'webhook' } })
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Webhook' } })
    fireEvent.change(screen.getByLabelText('External ID'), { target: { value: '  ' } })
    fireEvent.change(screen.getByLabelText('Signing header'), {
      target: { value: ' X-Hook-Signature ' },
    })
    fireEvent.change(screen.getByLabelText('Secret'), { target: { value: ' new-secret ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))

    await waitFor(() => {
      expect(mocks.addInboxChannelFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'webhook',
          label: 'Webhook',
          externalId: null,
          enabled: true,
          config: {
            signingHeader: 'X-Hook-Signature',
            secret: 'new-secret',
          },
        }),
      })
    })
  })

  it('updates an existing webhook channel without changing its kind', async () => {
    renderDialog({
      id: 'inbox_channel_1',
      kind: 'webhook',
      label: 'Current webhook',
      externalId: null,
      enabled: false,
      config: { signingHeader: 'X-Old-Signature', retained: 'value' },
    } as never)
    openDialog()

    expect(screen.getByRole('heading', { name: 'Edit channel' })).toBeInTheDocument()
    expect(screen.getByLabelText('Kind')).toBeDisabled()
    expect(screen.getByText('Channel kind cannot change after creation.')).toBeInTheDocument()
    expect(screen.getByLabelText('Enabled')).not.toBeChecked()

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Updated webhook' } })
    fireEvent.change(screen.getByLabelText('Signing header'), {
      target: { value: ' X-New-Signature ' },
    })
    fireEvent.change(screen.getByLabelText(/Secret/), { target: { value: ' rotated ' } })
    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Save channel' }))

    await waitFor(() => {
      expect(mocks.updateInboxChannelFn).toHaveBeenCalledWith({
        data: {
          channelId: 'inbox_channel_1',
          label: 'Updated webhook',
          externalId: null,
          enabled: true,
          config: {
            signingHeader: 'X-New-Signature',
            retained: 'value',
            secret: 'rotated',
          },
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Channel updated')
  })

  it('cancels and reports update errors', async () => {
    mocks.updateInboxChannelFn.mockRejectedValueOnce(new Error('Cannot update channel'))
    renderDialog({
      id: 'inbox_channel_1',
      kind: 'api',
      label: 'API',
      externalId: 'api-1',
      enabled: true,
      config: null,
    } as never)
    openDialog()

    expect(screen.getByText('No additional configuration required.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Edit channel' })).not.toBeInTheDocument()

    openDialog()
    fireEvent.change(screen.getByLabelText('External ID'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save channel' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot update channel')
    })
  })
})
