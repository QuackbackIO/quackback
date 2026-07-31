// @vitest-environment happy-dom
/**
 * Component tests for the in-thread ticket intake form a send_ticket_form
 * block posts (block-ticket-form.tsx): required-subject gating, the
 * createMyTicketFn payload shape (title/details/email, auth headers
 * threaded through), and the filed confirmation on success.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BlockTicketForm } from '../block-ticket-form'

vi.mock('@/lib/server/functions/tickets', () => ({
  createMyTicketFn: vi.fn(async () => ({ id: 'ticket_1' })),
}))
import { createMyTicketFn } from '@/lib/server/functions/tickets'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

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
})
