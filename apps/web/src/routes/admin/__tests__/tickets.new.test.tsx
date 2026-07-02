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
  component: () => ReactElement
}

type MutationOptions<T> = {
  mutationFn: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  createTicketFn: vi.fn(async () => ({ id: 'ticket-1' })),
  createTicketInitialThreadFn: vi.fn(async () => ({ id: 'thread-1' })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  uploadImage: vi.fn(),
  fetch: vi.fn(async () => ({ ok: true })),
  consoleError: vi.fn(),
  myPermissions: {
    data: { principalId: 'principal-current' },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ to, children }: ComponentProps & { to: string }) => <a href={to}>{children}</a>,
  useRouter: () => ({ navigate: mocks.navigate }),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: <T,>(options: MutationOptions<T>) => ({
    isPending: false,
    mutate: () => {
      void options
        .mutationFn()
        .then((result) => options.onSuccess?.(result))
        .catch((error: Error) => options.onError?.(error))
    },
  }),
}))

vi.mock('@/components/admin/shared', () => ({
  createRouteErrorComponent: (message: string) => () => <div>{message}</div>,
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  createTicketFn: mocks.createTicketFn,
  createTicketInitialThreadFn: mocks.createTicketInitialThreadFn,
}))

vi.mock('@/lib/client/hooks/use-authz-queries', () => ({
  useMyPermissions: () => mocks.myPermissions,
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: mocks.uploadImage }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    asChild,
  }: ComponentProps & { type?: 'button' | 'submit'; asChild?: boolean }) =>
    asChild ? (
      <>{children}</>
    ) : (
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
    required,
    maxLength,
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    type?: string
    multiple?: boolean
    disabled?: boolean
    required?: boolean
    maxLength?: number
  }) => (
    <input
      id={id}
      value={type === 'file' ? undefined : value}
      onChange={onChange}
      type={type}
      multiple={multiple}
      disabled={disabled}
      required={required}
      maxLength={maxLength}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: ComponentProps & { htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
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
    SelectContent: ({ children }: ComponentProps) => <div>{children}</div>,
    SelectTrigger: ({ children }: ComponentProps) => <div>{children}</div>,
    SelectValue: () => <span />,
    SelectItem: ({ value, children }: ComponentProps & { value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
  }
})

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
    placeholder,
  }: {
    onChange: (json: unknown, html: string, markdown: string) => void
    placeholder?: string
  }) => (
    <div>
      <textarea
        aria-label="Description editor"
        placeholder={placeholder}
        onChange={(event) =>
          onChange(
            {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: event.currentTarget.value }],
                },
              ],
            },
            '',
            event.currentTarget.value
          )
        }
      />
      <button
        type="button"
        onClick={() =>
          onChange(
            {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'JSON only description' }],
                },
              ],
            },
            '',
            ''
          )
        }
      >
        Use JSON description
      </button>
    </div>
  ),
}))

vi.mock('@/components/tickets/ticket-create-editor-features', () => ({
  TICKET_CREATE_EDITOR_FEATURES: ['bold'],
}))

vi.mock('@/components/admin/shared/inbox-picker', () => ({
  InboxPicker: ({ onValueChange }: { onValueChange: (value: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('inbox-1')}>
      Pick inbox
    </button>
  ),
}))

vi.mock('@/components/admin/shared/org-picker', () => ({
  OrgPicker: ({ onValueChange }: { onValueChange: (value: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('org-1')}>
      Pick org
    </button>
  ),
}))

vi.mock('@/components/admin/shared/contact-picker', () => ({
  ContactPicker: ({ onValueChange }: { onValueChange: (value: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('contact-1')}>
      Pick contact
    </button>
  ),
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({
    value,
    onValueChange,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
  }) => (
    <button type="button" onClick={() => onValueChange(value ? null : 'principal-2')}>
      {value ? `Assignee ${value}` : 'Unassigned'}
    </button>
  ),
}))

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({ onValueChange }: { onValueChange: (value: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('team-1')}>
      Pick team
    </button>
  ),
}))

const { Route } = await import('../tickets.new')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

function submitForm() {
  fireEvent.submit(screen.getByRole('button', { name: 'Create ticket' }).closest('form')!)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.myPermissions = { data: { principalId: 'principal-current' } }
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(mocks.consoleError)
})

describe('admin new ticket route', () => {
  it('renders the ticket create form with default assignee from permissions', () => {
    renderPage()

    expect(screen.getByText('New ticket')).toBeTruthy()
    expect(screen.getByLabelText('Subject')).toBeTruthy()
    expect(screen.getByText('Assignee principal-current')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create ticket' })).toBeTruthy()
  })

  it('rejects submit without a subject before calling createTicketFn', () => {
    renderPage()

    submitForm()

    expect(mocks.toastError).toHaveBeenCalledWith('Subject is required')
    expect(mocks.createTicketFn).not.toHaveBeenCalled()
  })

  it('creates a ticket with selected metadata and falls back to plain text from JSON', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: '  Billing issue  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use JSON description' }))
    fireEvent.click(screen.getByRole('button', { name: 'high' }))
    fireEvent.click(screen.getByRole('button', { name: 'email' }))
    fireEvent.click(screen.getByRole('button', { name: 'private' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick inbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick team' }))
    fireEvent.click(screen.getByRole('button', { name: 'Assignee principal-current' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick org' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick contact' }))

    submitForm()

    await waitFor(() =>
      expect(mocks.createTicketFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subject: 'Billing issue',
          descriptionText: 'JSON only description',
          priority: 'high',
          channel: 'email',
          visibilityScope: 'private',
          inboxId: 'inbox-1',
          organizationId: 'org-1',
          requesterContactId: 'contact-1',
          primaryTeamId: 'team-1',
          assigneePrincipalId: null,
        }),
      })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ticket created')
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/tickets/$ticketId',
      params: { ticketId: 'ticket-1' },
    })
  })

  it('creates an initial thread and uploads selected attachments', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Attachment ticket' } })
    fireEvent.change(screen.getByLabelText('Description editor'), {
      target: { value: 'Attach this file' },
    })
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Attachments (optional)'), {
      target: { files: [file] },
    })

    expect(screen.getByText('hello.txt')).toBeTruthy()

    submitForm()

    await waitFor(() =>
      expect(mocks.createTicketInitialThreadFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket-1' },
      })
    )
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/tickets/ticket-1/threads/thread-1/attachments',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    )
  })

  it('logs attachment upload failures without blocking ticket creation', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false })
    renderPage()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Upload failure' } })
    fireEvent.change(screen.getByLabelText('Attachments (optional)'), {
      target: { files: [new File(['bad'], 'bad.txt')] },
    })

    submitForm()

    await waitFor(() => expect(mocks.consoleError).toHaveBeenCalledWith('Failed to upload bad.txt'))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ticket created')
  })

  it('surfaces createTicketFn errors through the mutation error handler', async () => {
    mocks.createTicketFn.mockRejectedValueOnce(new Error('No permission'))
    renderPage()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Denied' } })
    submitForm()

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('No permission'))
  })
})
