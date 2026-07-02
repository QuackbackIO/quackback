// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WebhookDeliveriesTable } from '../webhook-deliveries-table'

type Delivery = {
  id: string
  webhookId: string
  eventId: string
  eventType: string
  attemptNumber: number
  status: string
  httpStatus: number | null
  errorMessage: string | null
  requestUrl: string
  requestPayloadBytes: number
  responseBodySnippet: string | null
  latencyMs: number | null
  signatureTimestamp: number
  attemptedAt: string
  nextRetryAt: string | null
}

const mocks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  pages: [] as Array<{ deliveries: Delivery[] }>,
  hasNextPage: false,
  isFetchingNextPage: false,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseInfiniteQuery: () => ({
    data: { pages: mocks.pages },
    hasNextPage: mocks.hasNextPage,
    isFetchingNextPage: mocks.isFetchingNextPage,
    fetchNextPage: mocks.fetchNextPage,
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

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: { children: ReactNode; variant?: string; className?: string }) => (
    <span data-variant={variant ?? 'default'}>{children}</span>
  ),
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    colSpan,
    title,
  }: {
    children?: ReactNode
    colSpan?: number
    title?: string
    className?: string
  }) => (
    <td colSpan={colSpan} title={title}>
      {children}
    </td>
  ),
  TableHead: ({ children }: { children?: ReactNode; className?: string }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: ReactNode; className?: string }) => <tr>{children}</tr>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ChevronDownIcon: () => <span aria-hidden="true">down</span>,
  ChevronRightIcon: () => <span aria-hidden="true">right</span>,
}))

vi.mock('@/lib/client/queries/webhook-deliveries', () => ({
  webhookDeliveryQueries: {
    list: (webhookId: string, filters: { status?: string }) => ({
      queryKey: ['webhook-deliveries', webhookId, filters],
    }),
  },
}))

function delivery(overrides: Partial<Delivery>): Delivery {
  return {
    id: 'delivery_1',
    webhookId: 'webhook_1',
    eventId: 'event_1',
    eventType: 'ticket.created',
    attemptNumber: 1,
    status: 'success',
    httpStatus: 200,
    errorMessage: null,
    requestUrl: 'https://example.com/webhook',
    requestPayloadBytes: 128,
    responseBodySnippet: null,
    latencyMs: 42,
    signatureTimestamp: 1_718_707_200,
    attemptedAt: '2026-06-18T12:00:00.000Z',
    nextRetryAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pages = []
  mocks.hasNextPage = false
  mocks.isFetchingNextPage = false
})

describe('WebhookDeliveriesTable', () => {
  it('renders an empty delivery state and hidden pagination controls', () => {
    render(<WebhookDeliveriesTable webhookId={'webhook_empty' as never} status="success" />)

    expect(screen.getByText('No deliveries recorded for this webhook yet.')).toBeInTheDocument()
    expect(screen.getByText('0 deliveries shown')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('renders all status pills and compact fallback values', () => {
    mocks.pages = [
      {
        deliveries: [
          delivery({ id: 'success', status: 'success', eventType: 'ticket.created' }),
          delivery({
            id: 'retrying',
            status: 'failed_retryable',
            eventType: 'ticket.updated',
            httpStatus: null,
            latencyMs: null,
          }),
          delivery({ id: 'terminal', status: 'failed_terminal', eventType: 'ticket.closed' }),
          delivery({ id: 'blocked', status: 'blocked_ssrf', eventType: 'webhook.blocked' }),
          delivery({ id: 'queued', status: 'queued', eventType: 'webhook.queued' }),
          delivery({ id: 'custom', status: 'custom_state', eventType: 'webhook.custom' }),
        ],
      },
    ]

    render(<WebhookDeliveriesTable webhookId={'webhook_1' as never} />)

    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('Retrying')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Blocked (SSRF)')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('custom_state')).toBeInTheDocument()
    expect(screen.getByText('6 deliveries shown')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getAllByText('42ms')).toHaveLength(5)
  })

  it('expands and collapses details, including retry, error and response metadata', () => {
    mocks.pages = [
      {
        deliveries: [
          delivery({
            id: 'retrying',
            status: 'failed_retryable',
            eventId: 'event_retry',
            eventType: 'ticket.reply.created',
            errorMessage: 'Connection refused',
            responseBodySnippet: '{"ok":false}',
            nextRetryAt: '2026-06-18T12:10:00.000Z',
          }),
        ],
      },
    ]

    render(<WebhookDeliveriesTable webhookId={'webhook_1' as never} />)

    expect(screen.queryByText('Request URL')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand row' }))

    expect(screen.getByRole('button', { name: 'Collapse row' })).toBeInTheDocument()
    expect(screen.getByText('Request URL')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/webhook')).toBeInTheDocument()
    expect(screen.getByText('Event ID')).toBeInTheDocument()
    expect(screen.getByText('event_retry')).toBeInTheDocument()
    expect(screen.getByText('Payload size')).toBeInTheDocument()
    expect(screen.getByText('128 bytes')).toBeInTheDocument()
    expect(screen.getByText('Signature timestamp')).toBeInTheDocument()
    expect(screen.getByText(/1718707200/)).toBeInTheDocument()
    expect(screen.getByText('Next retry')).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
    expect(screen.getByText('Response body (snippet)')).toBeInTheDocument()
    expect(screen.getByText('{"ok":false}')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse row' }))
    expect(screen.queryByText('Request URL')).not.toBeInTheDocument()
  })

  it('fetches the next page and reflects loading state', () => {
    mocks.pages = [{ deliveries: [delivery({ id: 'success' })] }]
    mocks.hasNextPage = true

    const { rerender } = render(<WebhookDeliveriesTable webhookId={'webhook_1' as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)

    mocks.isFetchingNextPage = true
    rerender(<WebhookDeliveriesTable webhookId={'webhook_1' as never} />)

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()
  })
})
