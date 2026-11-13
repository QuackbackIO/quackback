// @vitest-environment happy-dom
/**
 * Component tests for the in-thread ticket intake form a send_ticket_form
 * block posts (block-ticket-form.tsx): required-subject gating, the
 * createMyTicketFn payload shape (title/details/email, auth headers
 * threaded through), the filed confirmation on success, and the optional
 * "Needed by" date the askDueDate toggle adds.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { endOfLocalDay, toLocalDateInputValue } from '@/lib/shared/ticket-due'
import { BlockTicketForm } from '../block-ticket-form'

vi.mock('@/lib/server/functions/tickets', () => ({
  createMyTicketFn: vi.fn(async () => ({ id: 'ticket_1' })),
  getConversationLinkedTicketFn: vi.fn(),
  getMyTicketStageLabelsFn: vi.fn(),
  getMyTicketFormFn: vi.fn(),
  getMyTicketWatchStatusFn: vi.fn(),
  watchMyTicketFn: vi.fn(),
  unwatchMyTicketFn: vi.fn(),
}))
import { createMyTicketFn } from '@/lib/server/functions/tickets'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderCard(
  headers: Record<string, string> = { 'x-widget-session': 'sess_1' },
  props: { askDueDate?: boolean } = {}
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
  it('keeps Create disabled until a subject is typed', () => {
    renderCard()
    const submit = screen.getByRole('button', { name: /create ticket/i })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/summarize your request/i), {
      target: { value: 'Cannot sign in' },
    })
    expect(submit).toBeEnabled()
  })

  it('submits the intake payload (title/details/email) with the surface auth headers', async () => {
    renderCard()
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
    fireEvent.click(screen.getByRole('button', { name: /create ticket/i }))

    await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    expect(createMyTicketFn).toHaveBeenCalledWith({
      data: { title: 'Refund request' },
      headers: { 'x-widget-session': 'sess_1' },
    })
    await screen.findByText(/ticket filed/i)
    expect(screen.queryByRole('button', { name: /create ticket/i })).toBeNull()
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
      fireEvent.click(screen.getByRole('button', { name: /create ticket/i }))

      expect(
        await screen.findByText('Pick a date between today and two years from now.')
      ).toBeTruthy()
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(createMyTicketFn).not.toHaveBeenCalled()

      // Picking an acceptable day clears the error and submits.
      fireEvent.change(input, { target: { value: dayFromNow(5) } })
      expect(screen.queryByText(/pick a date between/i)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /create ticket/i }))
      await waitFor(() => expect(createMyTicketFn).toHaveBeenCalledTimes(1))
    })
  })
})
