// @vitest-environment happy-dom
/**
 * Component tests for the in-thread ticket intake form a send_ticket_form
 * block posts (block-ticket-form.tsx): required-subject gating, the
 * createMyTicketFn payload shape (title/details/email, auth headers
 * threaded through), the filed confirmation on success, the intake
 * default type's customer-visible fields (shown, validated, and sent with
 * that type's id so the server's required-field check passes), and the
 * optional "Needed by" date the askDueDate toggle adds.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { endOfLocalDay, toLocalDateInputValue } from '@/lib/shared/ticket-due'
import { BlockTicketForm } from '../block-ticket-form'

vi.mock('@/lib/server/functions/tickets', () => ({
  createMyTicketFn: vi.fn(),
  getConversationLinkedTicketFn: vi.fn(),
  getMyTicketStageLabelsFn: vi.fn(),
  getMyTicketFormFn: vi.fn(),
  getMyTicketWatchStatusFn: vi.fn(),
  watchMyTicketFn: vi.fn(),
  unwatchMyTicketFn: vi.fn(),
  getMyTicketSharingFn: vi.fn(),
  listMyTicketColleaguesFn: vi.fn(),
  shareMyTicketFn: vi.fn(),
  removeMyTicketShareFn: vi.fn(),
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

/** The input a field label names (labels carry htmlFor; the visual required
 *  mark follows the label text). */
function inputUnder(label: string): HTMLInputElement {
  const node = screen.getByLabelText(new RegExp(`^${label}`))
  if (!(node instanceof HTMLInputElement)) throw new Error(`no input under ${label}`)
  return node
}

function renderCard(
  headers: Record<string, string> = { 'x-widget-session': 'sess_1' },
  props: { askEmail?: boolean; askDueDate?: boolean } = {}
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en-US" messages={{}}>
        <BlockTicketForm getAuthHeaders={() => headers} {...props} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The local calendar day `days` from now, as the date input reports it. */
function dayFromNow(days: number): string {
  return toLocalDateInputValue(new Date(Date.now() + days * DAY_MS))
}

describe('BlockTicketForm (send_ticket_form block card)', () => {
  it('links each label to its input', () => {
    renderCard()
    expect(screen.getByLabelText(/subject/i)).toBe(
      screen.getByPlaceholderText(/summarize your request/i)
    )
    expect(screen.getByLabelText(/details/i)).toBe(
      screen.getByPlaceholderText(/add anything that helps/i)
    )
    expect(screen.getByLabelText(/email/i)).toBe(screen.getByPlaceholderText(/you@example\.com/i))
  })

  it('names the subject without its asterisk and marks it required', () => {
    renderCard()
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveAttribute(
      'aria-required',
      'true'
    )
    expect(screen.getByRole('textbox', { name: 'Details' })).not.toHaveAttribute('aria-required')
  })

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

  it('does not ask an identified visitor for an email, and sends none', async () => {
    renderCard(undefined, { askEmail: false })
    expect(screen.queryByLabelText(/email/i)).toBeNull()
    expect(screen.queryByPlaceholderText(/you@example\.com/i)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Cannot sign in' },
    })
    const submit = screen.getByRole('button', { name: /create ticket/i })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)

    await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    expect(createMyTicketFn).toHaveBeenCalledWith({
      data: { title: 'Cannot sign in' },
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

  describe('Needed by (askDueDate)', () => {
    it('offers no date field without the toggle', () => {
      renderCard()
      expect(screen.queryByLabelText(/needed by/i)).toBeNull()
      expect(screen.queryByText(/our team may adjust this date/i)).toBeNull()
    })

    it('shows the optional field and its hint, bounded to the customer window after mount', async () => {
      renderCard(undefined, { askDueDate: true })
      const input = screen.getByLabelText(/needed by/i)
      expect(input).toHaveAttribute('type', 'date')
      expect(screen.getByText('(optional)')).toBeTruthy()
      expect(screen.getByText('Our team may adjust this date.')).toBeTruthy()
      await waitFor(() => expect(input).toHaveAttribute('min'))
      expect(input.getAttribute('min')! <= dayFromNow(0)).toBe(true)
      expect(input.getAttribute('max')! >= dayFromNow(729)).toBe(true)
      expect(input.getAttribute('max')! <= dayFromNow(731)).toBe(true)
    })

    it('sends the end of the picked local day as dueAt', async () => {
      renderCard(undefined, { askDueDate: true })
      const day = dayFromNow(10)
      fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
        target: { value: 'Renewal paperwork' },
      })
      fireEvent.change(screen.getByLabelText(/needed by/i), { target: { value: day } })
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /create ticket/i })).toBeEnabled()
      )
      fireEvent.click(screen.getByRole('button', { name: /create ticket/i }))

      await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
      expect(createMyTicketFn).toHaveBeenCalledWith({
        data: { title: 'Renewal paperwork', dueAt: endOfLocalDay(day)!.toISOString() },
        headers: { 'x-widget-session': 'sess_1' },
      })
    })

    it('leaves dueAt out when no day is picked', async () => {
      renderCard(undefined, { askDueDate: true })
      fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
        target: { value: 'Refund request' },
      })
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /create ticket/i })).toBeEnabled()
      )
      fireEvent.click(screen.getByRole('button', { name: /create ticket/i }))

      await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
      expect(createMyTicketFn).toHaveBeenCalledWith({
        data: { title: 'Refund request' },
        headers: { 'x-widget-session': 'sess_1' },
      })
    })

    it.each([
      ['more than two years out', 3 * 365],
      ['in the past', -3],
    ])('blocks a day %s with the inline error until it is fixed', async (_label, days) => {
      renderCard(undefined, { askDueDate: true })
      fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
        target: { value: 'Renewal paperwork' },
      })
      const input = screen.getByLabelText(/needed by/i)
      fireEvent.change(input, { target: { value: dayFromNow(days) } })
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /create ticket/i })).toBeEnabled()
      )
      fireEvent.click(screen.getByRole('button', { name: /create ticket/i }))

      expect(
        await screen.findByText('Pick a date between today and two years from now.')
      ).toBeTruthy()
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(createMyTicketFn).not.toHaveBeenCalled()

      // Picking an acceptable day clears the error and submits.
      fireEvent.change(input, { target: { value: dayFromNow(5) } })
      expect(screen.queryByText(/pick a date between/i)).toBeNull()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /create ticket/i })).toBeEnabled()
      )
      fireEvent.click(screen.getByRole('button', { name: /create ticket/i }))
      await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    })
  })
})
