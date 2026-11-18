// @vitest-environment happy-dom
/**
 * Component tests for the in-thread ticket intake form a send_ticket_form
 * block posts (block-ticket-form.tsx): required-subject gating, the
 * createMyTicketFn payload shape (title/details/email, auth headers
 * threaded through), the filed confirmation on success, and the intake
 * default type's customer-visible fields (shown, validated, and sent with
 * that type's id so the server's required-field check passes).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BlockTicketForm } from '../block-ticket-form'

vi.mock('@/lib/server/functions/tickets', () => ({
  createMyTicketFn: vi.fn(),
  getConversationLinkedTicketFn: vi.fn(),
  getMyTicketStageLabelsFn: vi.fn(),
  getMyTicketFormFn: vi.fn(),
  getMyTicketWatchStatusFn: vi.fn(),
  watchMyTicketFn: vi.fn(),
  unwatchMyTicketFn: vi.fn(),
}))
import { createMyTicketFn, getMyTicketFormFn } from '@/lib/server/functions/tickets'
import { validateTicketIntakeValues, type TicketIntakeType } from '@/lib/shared/tickets'

/** The intake types the form read returns for the current test (an empty
 *  list by default: no intake types). */
let intakeTypes: TicketIntakeType[] | undefined

/**
 * The create mock judges its input the way the server does: it resolves the
 * type (explicit id, else the intake default, else the first type) and runs
 * the shared validator over that type's customer-visible fields, rejecting
 * as the server would when a required answer is missing.
 */
function serverLikeCreate(args: {
  data: { ticketTypeId?: string; fieldValues?: Record<string, unknown> }
}) {
  const types = intakeTypes ?? []
  const type = args.data.ticketTypeId
    ? types.find((t) => t.id === args.data.ticketTypeId)
    : (types.find((t) => t.isDefault) ?? types[0])
  if (args.data.ticketTypeId && !type) return Promise.reject(new Error('INVALID_TICKET_TYPE'))
  if (type) {
    const result = validateTicketIntakeValues(type.fields, args.data.fieldValues ?? {})
    if (!result.ok) return Promise.reject(new Error(result.errors.map((e) => e.message).join('; ')))
  }
  return Promise.resolve({ id: 'ticket_1' })
}

beforeEach(() => {
  intakeTypes = undefined
  vi.mocked(createMyTicketFn).mockImplementation(serverLikeCreate as never)
  vi.mocked(getMyTicketFormFn).mockImplementation((async () => ({
    types: intakeTypes ?? [],
  })) as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const orderNumber = {
  key: 'order_number',
  label: 'Order number',
  type: 'text' as const,
  required: true,
  visibleToCustomer: true,
  order: 0,
}

function intakeType(id: string, isDefault: boolean, fields = [orderNumber]): TicketIntakeType {
  return { id, name: id, icon: null, color: '#6b7280', isDefault, fields }
}

/** The input rendered under a field label (labels carry no htmlFor). */
function inputUnder(label: string): HTMLInputElement {
  const node = screen.getByText(label).closest('div')?.querySelector('input')
  if (!node) throw new Error(`no input under ${label}`)
  return node
}

function renderCard(headers: Record<string, string> = { 'x-widget-session': 'sess_1' }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en-US" messages={{}}>
        <BlockTicketForm getAuthHeaders={() => headers} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('BlockTicketForm (send_ticket_form block card)', () => {
  it('keeps Create disabled until a subject is typed', async () => {
    renderCard()
    const submit = screen.getByRole('button', { name: /create ticket/i })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Cannot sign in' },
    })
    await waitFor(() => expect(submit).toBeEnabled())
  })

  it('submits the intake payload (title/details/email) with the surface auth headers', async () => {
    renderCard()
    await waitFor(() => expect(getMyTicketFormFn).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Cannot sign in' },
    })
    fireEvent.change(screen.getByPlaceholderText(/add anything that helps/i), {
      target: { value: 'SSO loop after password reset' },
    })
    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: 'sam@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create ticket/i }))

    await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    expect(createMyTicketFn).toHaveBeenCalledWith({
      data: {
        title: 'Cannot sign in',
        description: 'SSO loop after password reset',
        email: 'sam@example.com',
      },
      headers: { 'x-widget-session': 'sess_1' },
    })
  })

  it('omits blank details/email and collapses to the filed confirmation on success', async () => {
    renderCard()
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Refund request' },
    })
    const submit = screen.getByRole('button', { name: /create ticket/i })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)

    await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    expect(createMyTicketFn).toHaveBeenCalledWith({
      data: { title: 'Refund request' },
      headers: { 'x-widget-session': 'sess_1' },
    })
    await screen.findByText(/ticket filed/i)
    expect(screen.queryByRole('button', { name: /create ticket/i })).toBeNull()
  })

  it('shows the intake default type’s required field, blocks submit while it is empty, then files with that type', async () => {
    intakeTypes = [intakeType('ticket_type_other', false, []), intakeType('ticket_type_bug', true)]
    renderCard()
    await screen.findByText('Order number')
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Missing parcel' },
    })
    const submit = screen.getByRole('button', { name: /create ticket/i })
    await waitFor(() => expect(submit).toBeEnabled())

    fireEvent.click(submit)
    await screen.findByText('Order number is required')
    expect(createMyTicketFn).not.toHaveBeenCalled()

    fireEvent.change(inputUnder('Order number'), { target: { value: 'A-1001' } })
    fireEvent.click(submit)
    await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    expect(createMyTicketFn).toHaveBeenCalledWith({
      data: {
        title: 'Missing parcel',
        ticketTypeId: 'ticket_type_bug',
        fieldValues: { order_number: 'A-1001' },
      },
      headers: { 'x-widget-session': 'sess_1' },
    })
    await screen.findByText(/ticket filed/i)
  })

  it('uses the first intake type when none is the default', async () => {
    intakeTypes = [
      intakeType('ticket_type_first', false),
      intakeType('ticket_type_second', false, []),
    ]
    renderCard()
    await screen.findByText('Order number')
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Late delivery' },
    })
    fireEvent.change(inputUnder('Order number'), { target: { value: 'B-7' } })
    const submit = screen.getByRole('button', { name: /create ticket/i })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createMyTicketFn).mock.calls[0][0]).toMatchObject({
      data: { ticketTypeId: 'ticket_type_first', fieldValues: { order_number: 'B-7' } },
    })
    await screen.findByText(/ticket filed/i)
  })

  it('shows a loading state in the fields area and keeps Create off until the type list is in', async () => {
    let release: (value: { types: TicketIntakeType[] }) => void = () => {}
    vi.mocked(getMyTicketFormFn).mockImplementation(
      (() =>
        new Promise((resolve) => {
          release = resolve
        })) as never
    )
    renderCard()
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Missing parcel' },
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /create ticket/i })
    expect(submit).toBeDisabled()

    release({ types: [intakeType('ticket_type_bug', true)] })
    await screen.findByText('Order number')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows an error with Try again when the type list cannot be read, and never sends without it', async () => {
    vi.mocked(getMyTicketFormFn).mockRejectedValueOnce(new Error())
    intakeTypes = [intakeType('ticket_type_bug', true)]
    renderCard()
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Missing parcel' },
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn.t load this form/i)
    const submit = screen.getByRole('button', { name: /create ticket/i })
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(createMyTicketFn).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await screen.findByText('Order number')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(inputUnder('Order number'), { target: { value: 'A-1001' } })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createMyTicketFn).mock.calls[0][0]).toMatchObject({
      data: { ticketTypeId: 'ticket_type_bug', fieldValues: { order_number: 'A-1001' } },
    })
  })
})
