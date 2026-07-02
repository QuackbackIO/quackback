// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}

type RouteOptions = {
  beforeLoad: (input: { context: Record<string, unknown> }) => Promise<void>
  loader: (input: {
    context: {
      session?: { user?: { id?: string } } | null
      queryClient: { ensureQueryData: (query: unknown) => Promise<unknown> }
      settings?: { name?: string }
    }
    deps: { status: 'open' | 'pending' | 'solved' | 'closed' | 'all' }
  }) => Promise<{ workspaceName: string }>
  head: (input: { loaderData?: { workspaceName?: string } }) => { meta: Array<{ title: string }> }
  component: () => ReactElement
}

const mocks = vi.hoisted(() => ({
  search: { status: 'open' as 'open' | 'pending' | 'solved' | 'closed' | 'all' },
  navigate: vi.fn(),
  ensureQueryData: vi.fn(async () => undefined),
  rows: [] as Array<{ id: string; subject: string }>,
  createTicket: vi.fn(async () => ({ id: 'ticket-1' })),
  createTicketInitialThreadFn: vi.fn(async () => ({ id: 'thread-1' })),
  uploadImage: vi.fn(),
  fetch: vi.fn(async () => ({ ok: true, text: async () => '' })),
  consoleError: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
  }),
  redirect: (input: unknown) => {
    throw { redirect: input }
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: { rows: mocks.rows } }),
}))

vi.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) => defaultMessage,
  }),
  FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => <>{defaultMessage}</>,
}))

vi.mock('@/lib/client/queries/portal-tickets', () => ({
  portalTicketQueries: {
    list: (params: unknown) => ({ queryKey: ['portalTickets', params], params }),
  },
  useCreateMyTicket: () => ({
    isPending: false,
    mutateAsync: mocks.createTicket,
  }),
}))

vi.mock('@/lib/server/functions/portal-tickets', () => ({
  createTicketInitialThreadFn: mocks.createTicketInitialThreadFn,
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalImageUpload: () => ({ upload: mocks.uploadImage }),
}))

vi.mock('@/components/tickets/ticket-create-editor-features', () => ({
  TICKET_CREATE_EDITOR_FEATURES: ['bold'],
}))

vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
}))

vi.mock('@/components/public/tickets/portal-ticket-row', () => ({
  PortalTicketRowItem: ({ ticket }: { ticket: { id: string; subject: string } }) => (
    <article>
      Row {ticket.id} {ticket.subject}
    </article>
  ),
}))

vi.mock('@/components/public/tickets/portal-ticket-status-filter', () => ({
  PortalTicketStatusFilter: ({ value }: { value: string }) => <div>Filter {value}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: ComponentProps & { type?: 'button' | 'submit' }) => (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    value,
    onChange,
    type,
    multiple,
    disabled,
    placeholder,
    maxLength,
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    type?: string
    multiple?: boolean
    disabled?: boolean
    placeholder?: string
    maxLength?: number
  }) => (
    <input
      id={id}
      value={type === 'file' ? undefined : value}
      onChange={onChange}
      type={type}
      multiple={multiple}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: ComponentProps & { htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
    placeholder,
  }: {
    onChange: (json: unknown, html?: string, markdown?: string) => void
    placeholder?: string
  }) => (
    <textarea
      aria-label="Details editor"
      placeholder={placeholder}
      onChange={(event) =>
        onChange({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: event.currentTarget.value }],
            },
          ],
        })
      }
    />
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: ComponentProps) => (
    <section className={className}>{children}</section>
  ),
  CardHeader: ({ children, className }: ComponentProps) => (
    <header className={className}>{children}</header>
  ),
  CardTitle: ({ children }: ComponentProps) => <h2>{children}</h2>,
  CardDescription: ({ children }: ComponentProps) => <p>{children}</p>,
  CardAction: ({ children }: ComponentProps) => <div>{children}</div>,
  CardContent: ({ children, className }: ComponentProps) => (
    <div className={className}>{children}</div>
  ),
}))

const { Route } = await import('../tickets.index')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search = { status: 'open' }
  mocks.rows = []
  mocks.createTicket.mockResolvedValue({ id: 'ticket-1' })
  mocks.createTicketInitialThreadFn.mockResolvedValue({ id: 'thread-1' })
  mocks.fetch.mockResolvedValue({ ok: true, text: async () => '' })
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(mocks.consoleError)
})

describe('portal tickets index route', () => {
  it('redirects before load when the My tickets tab is disabled', async () => {
    await expect(
      routeOptions().beforeLoad({ context: { enabledTabs: { myTickets: false } } })
    ).rejects.toEqual({ redirect: { to: '/' } })
  })

  it('redirects anonymous users to portal login', async () => {
    await expect(
      routeOptions().loader({
        context: {
          session: null,
          queryClient: { ensureQueryData: mocks.ensureQueryData },
          settings: { name: 'Acme' },
        },
        deps: { status: 'open' },
      })
    ).rejects.toEqual({
      redirect: { to: '/auth/login', search: { next: '/tickets' } },
    })
  })

  it('prefetches filtered tickets and builds the page title', async () => {
    const result = await routeOptions().loader({
      context: {
        session: { user: { id: 'user-1' } },
        queryClient: { ensureQueryData: mocks.ensureQueryData },
        settings: { name: 'Acme' },
      },
      deps: { status: 'all' },
    })

    expect(result).toEqual({ workspaceName: 'Acme' })
    expect(mocks.ensureQueryData).toHaveBeenCalledWith({
      queryKey: ['portalTickets', { statusCategory: undefined }],
      params: { statusCategory: undefined },
    })
    expect(routeOptions().head({ loaderData: result })).toEqual({
      meta: [{ title: 'My tickets · Acme' }],
    })
  })

  it('opens the composer by default for an empty ticket list and creates a ticket with attachments', async () => {
    renderPage()

    expect(screen.getByText('My tickets')).toBeTruthy()
    expect(screen.getByText('Open a ticket')).toBeTruthy()
    expect(screen.getByText('No tickets yet')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: ' Broken billing ' } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'urgent' } })
    fireEvent.change(screen.getByLabelText('Details editor'), {
      target: { value: 'Invoices fail to load' },
    })
    const file = new File(['log'], 'error.log', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Attachments (optional)'), {
      target: { files: [file] },
    })

    expect(screen.getByText('error.log')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    await waitFor(() =>
      expect(mocks.createTicket).toHaveBeenCalledWith({
        subject: 'Broken billing',
        priority: 'urgent',
        descriptionJson: expect.objectContaining({ type: 'doc' }),
        descriptionText: 'Invoices fail to load',
      })
    )
    expect(mocks.createTicketInitialThreadFn).toHaveBeenCalledWith({
      data: { ticketId: 'ticket-1' },
    })
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/tickets/ticket-1/threads/thread-1/attachments',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    )
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/tickets/$ticketId',
      params: { ticketId: 'ticket-1' },
    })
  })

  it('renders existing tickets with composer closed until requested', () => {
    mocks.rows = [{ id: 'ticket-2', subject: 'Existing ticket' }]
    mocks.search = { status: 'closed' }

    renderPage()

    expect(screen.getByText('Row ticket-2 Existing ticket')).toBeTruthy()
    expect(screen.getByText('Filter closed')).toBeTruthy()
    expect(screen.queryByText('Open a ticket')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }))
    expect(screen.getByText('Open a ticket')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide form' }))
    expect(screen.queryByText('Open a ticket')).toBeNull()
  })

  it('keeps the created ticket flow moving when attachment upload fails', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, text: async () => 'bad upload' })
    renderPage()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Upload warning' } })
    fireEvent.change(screen.getByLabelText('Details editor'), { target: { value: 'Details' } })
    fireEvent.change(screen.getByLabelText('Attachments (optional)'), {
      target: { files: [new File(['x'], 'x.txt')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/tickets/$ticketId',
      params: { ticketId: 'ticket-1' },
    })
  })

  it('logs ticket creation failures and stays on the form', async () => {
    mocks.createTicket.mockRejectedValueOnce(new Error('Denied'))
    renderPage()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Denied ticket' } })
    fireEvent.change(screen.getByLabelText('Details editor'), { target: { value: 'Details' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    await waitFor(() =>
      expect(mocks.consoleError).toHaveBeenCalledWith('Ticket creation failed:', expect.any(Error))
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
