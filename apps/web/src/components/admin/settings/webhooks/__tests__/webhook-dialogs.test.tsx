// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateWebhookDialog } from '../create-webhook-dialog'
import { EditWebhookDialog } from '../edit-webhook-dialog'
import { TestWebhookDialog } from '../test-webhook-dialog'
import { WebhookDeliveriesDrawer } from '../webhook-deliveries-drawer'

type WebhookFixture = {
  id: string
  url: string
  events: string[]
  inboxIds?: string[] | null
  status: 'active' | 'disabled'
  failureCount: number
  lastError?: string | null
}

const mocks = vi.hoisted(() => ({
  createWebhookFn: vi.fn(),
  updateWebhookFn: vi.fn(),
  testWebhookFn: vi.fn(),
  invalidateQueries: vi.fn(),
  routerInvalidate: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: mocks.routerInvalidate,
  }),
}))

vi.mock('@/lib/server/functions/webhooks', () => ({
  createWebhookFn: mocks.createWebhookFn,
  testWebhookFn: mocks.testWebhookFn,
  updateWebhookFn: mocks.updateWebhookFn,
}))

vi.mock('@/components/shared/secret-reveal-dialog', () => ({
  SecretRevealDialog: ({
    open,
    title,
    description,
    secretLabel,
    secretValue,
    confirmLabel,
    onOpenChange,
    children,
  }: {
    open: boolean
    title: string
    description: string
    secretLabel: string
    secretValue: string
    confirmLabel: string
    onOpenChange: (open: boolean) => void
    children?: ReactNode
  }) =>
    open ? (
      <section>
        <h2>{title}</h2>
        <p>{description}</p>
        <span>{secretLabel}</span>
        <code>{secretValue}</code>
        {children}
        <button type="button" onClick={() => onOpenChange(false)}>
          {confirmLabel}
        </button>
      </section>
    ) : null,
}))

vi.mock('../webhook-event-picker', () => ({
  WebhookEventPicker: ({
    value,
    onChange,
    disabled,
  }: {
    value: string[]
    onChange: (value: string[]) => void
    disabled?: boolean
  }) => (
    <section>
      <span>Events: {value.join(', ') || 'none'}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...value, 'ticket.created'])}
      >
        Add ticket event
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange([])}>
        Clear events
      </button>
    </section>
  ),
}))

vi.mock('../webhook-inbox-picker', () => ({
  WebhookInboxPicker: ({
    value,
    onChange,
    active,
    disabled,
  }: {
    value: string[]
    onChange: (value: string[]) => void
    active: boolean
    disabled?: boolean
  }) => (
    <section>
      <span>
        Inbox picker {active ? 'active' : 'inactive'}: {value.join(', ') || 'all'}
      </span>
      <button
        type="button"
        disabled={disabled || !active}
        onClick={() => onChange([...value, 'inbox_1'])}
      >
        Add inbox
      </button>
    </section>
  ),
}))

vi.mock('../rotate-webhook-secret-dialog', () => ({
  RotateWebhookSecretDialog: ({
    open,
    onOpenChange,
    onSecretRotated,
  }: {
    webhook: WebhookFixture
    open: boolean
    onOpenChange: (open: boolean) => void
    onSecretRotated: (secret: string) => void
  }) =>
    open ? (
      <section>
        <button
          type="button"
          onClick={() => {
            onSecretRotated('whsec_new')
            onOpenChange(false)
          }}
        >
          Confirm rotate
        </button>
      </section>
    ) : null,
}))

vi.mock('../webhook-deliveries-table', () => ({
  WebhookDeliveriesTable: ({ webhookId, status }: { webhookId: string; status?: string }) => (
    <div>
      Deliveries table {webhookId} {status ?? 'all'}
    </div>
  ),
}))

vi.mock('@/components/shared/copy-button', () => ({
  CopyButton: ({
    value,
  }: {
    value: string
    'aria-label'?: string
    variant?: string
    size?: string
  }) => <button type="button">Copy {value}</button>,
}))

vi.mock('@/components/shared/warning-box', () => ({
  WarningBox: ({
    title,
    description,
  }: {
    variant: string
    title: string
    description?: string
  }) => (
    <aside>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </aside>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({
    children,
    open,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children: ReactNode; side?: string; className?: string }) => (
    <section>{children}</section>
  ),
  SheetDescription: ({
    children,
    title,
  }: {
    children: ReactNode
    title?: string
    className?: string
  }) => <p title={title}>{children}</p>,
  SheetHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    'aria-label'?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
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
    type = 'text',
    disabled,
  }: {
    id?: string
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    placeholder?: string
    type?: string
    disabled?: boolean
    required?: boolean
  }) => (
    <input
      id={id}
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string; className?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    id?: string
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
    'aria-label'?: string
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      children?: ReactNode
    }) => (
      <SelectContext.Provider value={{ onValueChange }}>
        <div data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children }: { children?: ReactNode; id?: string; className?: string }) => (
      <>{children}</>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  }
})

vi.mock('@heroicons/react/24/outline', () => ({
  ArrowPathIcon: () => <span aria-hidden="true">rotate</span>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  CheckCircleIcon: () => <span aria-hidden="true">success</span>,
  XCircleIcon: () => <span aria-hidden="true">failure</span>,
}))

function webhook(overrides: Partial<WebhookFixture> = {}): WebhookFixture {
  return {
    id: 'webhook_1',
    url: 'https://example.test/webhook',
    events: ['ticket.created'],
    inboxIds: null,
    status: 'active',
    failureCount: 0,
    lastError: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWebhookFn.mockResolvedValue({ secret: 'whsec_created' })
  mocks.updateWebhookFn.mockResolvedValue({ ok: true })
  mocks.testWebhookFn.mockResolvedValue({
    success: true,
    eventId: 'evt_test_1',
    errorMessage: null,
  })
})

describe('CreateWebhookDialog', () => {
  it('creates a webhook with ticket inbox scope and reveals the signing secret', async () => {
    const onOpenChange = vi.fn()
    render(<CreateWebhookDialog open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://receiver.test/hooks/quackback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket event' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add inbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Webhook' }))

    await waitFor(() => {
      expect(mocks.createWebhookFn).toHaveBeenCalledWith({
        data: {
          url: 'https://receiver.test/hooks/quackback',
          events: ['ticket.created'],
          inboxIds: ['inbox_1'],
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'webhooks'] })
    expect(mocks.routerInvalidate).toHaveBeenCalled()
    expect(screen.getByText('Webhook Created')).toBeInTheDocument()
    expect(screen.getByText('whsec_created')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: "I've saved my secret" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows create failures with no inbox scope when no inbox is selected', async () => {
    mocks.createWebhookFn.mockRejectedValueOnce('denied')
    render(<CreateWebhookDialog open onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://receiver.test/hooks/quackback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket event' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Webhook' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to create webhook')).toBeInTheDocument()
    })
    expect(mocks.createWebhookFn).toHaveBeenCalledWith({
      data: {
        url: 'https://receiver.test/hooks/quackback',
        events: ['ticket.created'],
        inboxIds: undefined,
      },
    })
  })
})

describe('EditWebhookDialog', () => {
  it('updates webhook configuration, rotates the secret, and shows auto-disabled warnings', async () => {
    const onOpenChange = vi.fn()
    render(
      <EditWebhookDialog
        open
        onOpenChange={onOpenChange}
        webhook={
          webhook({
            status: 'disabled',
            failureCount: 50,
            lastError: 'Endpoint returned 500',
            inboxIds: ['inbox_old'],
          }) as never
        }
      />
    )

    expect(screen.getByText('Auto-disabled after 50 failures')).toBeInTheDocument()
    expect(screen.getByText('Last error: Endpoint returned 500')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://receiver.test/new' },
    })
    fireEvent.click(screen.getByLabelText('Toggle webhook enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Add inbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(mocks.updateWebhookFn).toHaveBeenCalledWith({
        data: {
          webhookId: 'webhook_1',
          url: 'https://receiver.test/new',
          events: ['ticket.created'],
          inboxIds: ['inbox_old', 'inbox_1'],
          status: 'active',
        },
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: 'Rotate signing secret' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rotate' }))
    expect(screen.getByText('whsec_new')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy whsec_new' })).toBeInTheDocument()
  })

  it('validates events and reports update failures', async () => {
    mocks.updateWebhookFn.mockRejectedValueOnce(new Error('Webhook rejected'))
    render(<EditWebhookDialog open onOpenChange={vi.fn()} webhook={webhook() as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear events' }))
    fireEvent.submit(screen.getByLabelText('Endpoint URL').closest('form') as HTMLFormElement)
    expect(screen.getByText('Select at least one event')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add ticket event' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(screen.getByText('Webhook rejected')).toBeInTheDocument()
    })
  })
})

describe('TestWebhookDialog', () => {
  it('sends test events, reports outcomes, and resets on close', async () => {
    const onOpenChange = vi.fn()
    render(<TestWebhookDialog webhook={webhook() as never} onOpenChange={onOpenChange} />)

    expect(screen.getByText(/Posts a canonical sample payload/)).toHaveTextContent(
      'https://example.test/webhook'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }))

    await waitFor(() => {
      expect(mocks.testWebhookFn).toHaveBeenCalledWith({
        data: { webhookId: 'webhook_1', eventType: 'ticket.created' },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'webhook-deliveries'],
    })
    expect(screen.getByText('Delivered successfully')).toBeInTheDocument()
    expect(screen.getByText('Event id: evt_test_1')).toBeInTheDocument()

    mocks.testWebhookFn.mockResolvedValueOnce({
      success: false,
      eventId: 'evt_test_2',
      errorMessage: 'HTTP 500',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }))
    await waitFor(() => {
      expect(screen.getByText('Delivery failed')).toBeInTheDocument()
    })
    expect(screen.getByText('HTTP 500')).toBeInTheDocument()

    mocks.testWebhookFn.mockRejectedValueOnce('network down')
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }))
    await waitFor(() => {
      expect(screen.getByText('Test failed')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders nothing without a selected webhook', () => {
    render(<TestWebhookDialog webhook={null} onOpenChange={vi.fn()} />)

    expect(screen.queryByText('Send test event')).not.toBeInTheDocument()
  })
})

describe('WebhookDeliveriesDrawer', () => {
  it('filters deliveries by status and hides content without a webhook', () => {
    const { rerender } = render(
      <WebhookDeliveriesDrawer webhook={webhook() as never} onOpenChange={vi.fn()} />
    )

    expect(screen.getByText('Deliveries')).toBeInTheDocument()
    expect(screen.getByText('https://example.test/webhook')).toHaveAttribute(
      'title',
      'https://example.test/webhook'
    )
    expect(screen.getByText('Deliveries table webhook_1 all')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(screen.getByText('Deliveries table webhook_1 failed_terminal')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Any' }))
    expect(screen.getByText('Deliveries table webhook_1 all')).toBeInTheDocument()

    rerender(<WebhookDeliveriesDrawer webhook={null} onOpenChange={vi.fn()} />)
    expect(screen.queryByText('Deliveries')).not.toBeInTheDocument()
  })
})
