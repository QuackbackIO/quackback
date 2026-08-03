// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WebhooksSettings } from '../webhooks-settings'

type WebhookFixture = {
  id: string
  url: string
  events: string[]
  status: 'active' | 'disabled'
  failureCount: number
  lastTriggeredAt?: Date | null
  lastError?: string | null
}

vi.mock('../create-webhook-dialog', () => ({
  CreateWebhookDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <section>
        <span>Create webhook dialog</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close create
        </button>
      </section>
    ) : null,
}))

vi.mock('../edit-webhook-dialog', () => ({
  EditWebhookDialog: ({
    webhook,
    open,
    onOpenChange,
  }: {
    webhook: WebhookFixture
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <section>
        <span>Edit {webhook.url}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close edit
        </button>
      </section>
    ) : null,
}))

vi.mock('../delete-webhook-dialog', () => ({
  DeleteWebhookDialog: ({
    webhook,
    open,
    onOpenChange,
  }: {
    webhook: WebhookFixture
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <section>
        <span>Delete {webhook.url}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close delete
        </button>
      </section>
    ) : null,
}))

vi.mock('../webhook-deliveries-drawer', () => ({
  WebhookDeliveriesDrawer: ({
    webhook,
    onOpenChange,
  }: {
    webhook: WebhookFixture | null
    onOpenChange: (open: boolean) => void
  }) =>
    webhook ? (
      <section>
        <span>Deliveries {webhook.url}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close deliveries
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    icon: unknown
    title: string
    description: string
    action?: ReactNode
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, title }: { children: ReactNode; variant?: string; title?: string }) => (
    <span title={title}>{children}</span>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode; align?: string }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  BoltIcon: () => <span aria-hidden="true">bolt</span>,
  PencilIcon: () => <span aria-hidden="true">edit</span>,
  PlusIcon: () => <span aria-hidden="true">plus</span>,
  QueueListIcon: () => <span aria-hidden="true">queue</span>,
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  EllipsisVerticalIcon: () => <span aria-hidden="true">menu</span>,
}))

function webhook(overrides: Partial<WebhookFixture> = {}): WebhookFixture {
  return {
    id: overrides.id ?? 'webhook_1',
    url: overrides.url ?? 'https://receiver.test/hook',
    events: overrides.events ?? ['post.created', 'ticket.created'],
    status: overrides.status ?? 'active',
    failureCount: overrides.failureCount ?? 0,
    lastTriggeredAt: overrides.lastTriggeredAt ?? null,
    lastError: overrides.lastError ?? null,
  }
}

describe('WebhooksSettings', () => {
  it('opens the create dialog from the empty state and closes it', () => {
    render(<WebhooksSettings webhooks={[]} />)

    expect(screen.getByText('No webhooks configured')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Create your first webhook/ }))
    expect(screen.getByText('Create webhook dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close create' }))
    expect(screen.queryByText('Create webhook dialog')).not.toBeInTheDocument()
  })

  it('renders statuses, event labels, timestamps, errors, and opens row actions', () => {
    render(
      <WebhooksSettings
        webhooks={
          [
            webhook({
              id: 'webhook_active',
              url: 'https://receiver.test/active',
              events: ['post.created', 'ticket.created'],
              lastTriggeredAt: new Date(Date.now() - 60_000),
            }),
            webhook({
              id: 'webhook_issues',
              url: 'https://receiver.test/issues',
              events: ['comment.created'],
              failureCount: 2,
              lastError: 'HTTP 502',
            }),
            webhook({
              id: 'webhook_failing',
              url: 'https://receiver.test/failing',
              events: ['post.status_changed'],
              failureCount: 25,
            }),
            webhook({
              id: 'webhook_disabled',
              url: 'https://receiver.test/disabled',
              events: ['changelog.published'],
              status: 'disabled',
            }),
            webhook({
              id: 'webhook_auto_disabled',
              url: 'https://receiver.test/auto',
              events: ['unknown.event'],
              status: 'disabled',
              failureCount: 50,
              lastError: 'too many failures',
            }),
          ] as never
        }
      />
    )

    expect(screen.getByText('5 of 25 webhooks')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Issues (2)')).toHaveAttribute('title', '2 consecutive failures')
    expect(screen.getByText('Failing (25/50)')).toHaveAttribute('title', '25 consecutive failures')
    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.getByText('Auto-disabled')).toHaveAttribute(
      'title',
      'Auto-disabled after 50 failures'
    )
    expect(screen.getByText(/New Post/)).toHaveTextContent('ticket.created')
    expect(screen.getByText('New Comment')).toBeInTheDocument()
    expect(screen.getByText('Status Changed')).toBeInTheDocument()
    expect(screen.getByText('Changelog Published')).toBeInTheDocument()
    expect(screen.getByText('unknown.event')).toBeInTheDocument()
    expect(screen.getByText(/Last fired/)).toBeInTheDocument()
    expect(screen.getByText('Error: HTTP 502')).toHaveAttribute('title', 'HTTP 502')
    expect(screen.getByText('Error: too many failures')).toHaveAttribute(
      'title',
      'too many failures'
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'View deliveries for https://receiver.test/active',
      })
    )
    expect(screen.getByText('Deliveries https://receiver.test/active')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close deliveries' }))
    expect(screen.queryByText('Deliveries https://receiver.test/active')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit webhook https://receiver.test/active',
      })
    )
    expect(screen.getByText('Edit https://receiver.test/active')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close edit' }))
    expect(screen.queryByText('Edit https://receiver.test/active')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Delete webhook https://receiver.test/active',
      })
    )
    expect(screen.getByText('Delete https://receiver.test/active')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close delete' }))
    expect(screen.queryByText('Delete https://receiver.test/active')).not.toBeInTheDocument()
  })

  it('opens the create dialog from the header and disables creation at the limit', () => {
    const { rerender } = render(
      <WebhooksSettings webhooks={[webhook({ id: 'webhook_1' })] as never} />
    )

    fireEvent.click(screen.getByRole('button', { name: /Create Webhook/ }))
    expect(screen.getByText('Create webhook dialog')).toBeInTheDocument()

    rerender(
      <WebhooksSettings
        webhooks={
          Array.from({ length: 25 }, (_, index) =>
            webhook({
              id: `webhook_${index}`,
              url: `https://receiver.test/${index}`,
            })
          ) as never
        }
      />
    )

    expect(screen.getByRole('button', { name: /Create Webhook/ })).toBeDisabled()
  })
})
