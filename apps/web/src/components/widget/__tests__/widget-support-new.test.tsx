// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const mockAuth = vi.hoisted(() => ({
  isIdentified: true,
  hmacRequired: false,
  identifyWithEmail: vi.fn(async () => true),
  ensureSessionThen: vi.fn(async (cb: () => Promise<void> | void) => {
    await cb()
  }),
  emitEvent: vi.fn(),
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => mockAuth,
}))

const createWidgetTicket = vi.hoisted(() => vi.fn())

// The body field is a TipTap RichTextEditor, which renders its placeholder as a
// ProseMirror `data-placeholder` rather than a native `placeholder` attribute
// and is far too heavy to mount in a unit test. Stub it with a <textarea> that
// exposes the same native placeholder and emits TipTap-shaped JSON on change.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
    placeholder,
    disabled,
  }: {
    onChange: (json: unknown) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <textarea
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        const text = event.currentTarget.value
        onChange({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: text ? [{ type: 'text', text }] : [],
            },
          ],
        })
      }}
    />
  ),
}))

vi.mock('@/lib/client/widget/tickets-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/client/widget/tickets-api')>(
    '@/lib/client/widget/tickets-api'
  )
  return {
    ...actual,
    createWidgetTicket,
  }
})

import { WidgetSupportNew } from '../widget-support-new'

function renderForm(onCreated = vi.fn()) {
  return {
    onCreated,
    ...render(
      <IntlProvider locale="en" defaultLocale="en">
        <WidgetSupportNew onCreated={onCreated} />
      </IntlProvider>
    ),
  }
}

afterEach(() => {
  vi.clearAllMocks()
  mockAuth.isIdentified = true
  mockAuth.hmacRequired = false
})

describe('WidgetSupportNew', () => {
  it('submits a ticket and invokes onCreated', async () => {
    createWidgetTicket.mockResolvedValueOnce({
      id: 't1',
      subject: 'Hello',
      statusId: 's1',
      statusCategory: 'open',
      statusName: 'Open',
      statusColor: null,
      createdAt: '2026-01-01T00:00:00Z',
      lastActivityAt: '2026-01-01T00:00:00Z',
    })
    const { onCreated } = renderForm()

    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByPlaceholderText('Describe your issue...'), {
      target: { value: 'world' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(createWidgetTicket).toHaveBeenCalledTimes(1))
    // The composer now sends the rich-text body as `bodyJson` (TipTap doc)
    // alongside the derived `bodyText`, plus the resolved `categoryKey`
    // (undefined here — no categories configured). bodyJson mirrors what the
    // RichTextEditor mock emits for the typed text.
    expect(createWidgetTicket).toHaveBeenCalledWith({
      subject: 'Hello',
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'world' }] }],
      },
      bodyText: 'world',
      priority: 'normal',
      categoryKey: undefined,
    })
    await waitFor(() =>
      expect(mockAuth.emitEvent).toHaveBeenCalledWith('ticket:created', expect.any(Object))
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })

  it('shows email field when not identified and calls identifyWithEmail first', async () => {
    mockAuth.isIdentified = false
    createWidgetTicket.mockResolvedValueOnce({
      id: 't2',
      subject: 'S',
      statusId: 's1',
      statusCategory: 'open',
      statusName: 'Open',
      statusColor: null,
      createdAt: '2026-01-01T00:00:00Z',
      lastActivityAt: '2026-01-01T00:00:00Z',
    })
    renderForm()

    expect(screen.getByPlaceholderText('Your email')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'S' } })
    fireEvent.change(screen.getByPlaceholderText('Describe your issue...'), {
      target: { value: 'B' },
    })
    fireEvent.change(screen.getByPlaceholderText('Your email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(mockAuth.identifyWithEmail).toHaveBeenCalledWith('a@b.com', undefined)
    )
    await waitFor(() => expect(createWidgetTicket).toHaveBeenCalled())
  })

  it('disables submit when subject or body is empty', () => {
    renderForm()
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'only subject' } })
    expect(send.disabled).toBe(true)
  })
})
