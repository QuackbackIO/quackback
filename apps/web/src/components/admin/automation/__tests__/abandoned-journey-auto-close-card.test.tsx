// @vitest-environment happy-dom
/**
 * Smoke coverage for the abandoned-journey auto-close card: seeds from
 * fetchWorkflowAbandonedAutoCloseFn (off by default), only shows the wait
 * minutes + keep-if-email controls once enabled, and saves through
 * updateWorkflowAbandonedAutoCloseFn on change.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockUpdateFn = vi.fn(async (input: { data: unknown }) => input.data)

vi.mock('@/lib/server/functions/settings', () => ({
  fetchWorkflowAbandonedAutoCloseFn: vi.fn(async () => ({
    enabled: false,
    waitMinutes: 5,
    keepIfEmailCaptured: true,
  })),
  updateWorkflowAbandonedAutoCloseFn: (input: { data: unknown }) => mockUpdateFn(input),
}))

import { AbandonedJourneyAutoCloseCard } from '../abandoned-journey-auto-close-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('AbandonedJourneyAutoCloseCard', () => {
  it('renders the card title and defaults to off, hiding the wait/keep controls', async () => {
    renderWithClient(<AbandonedJourneyAutoCloseCard />)
    expect(await screen.findByText('Abandoned journeys')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByLabelText('Auto-close abandoned journeys')).not.toBeChecked()
    )
    expect(screen.queryByLabelText('Wait before closing')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Keep open if an email was captured')).not.toBeInTheDocument()
  })

  it('reveals wait minutes + keep-if-email once enabled from a saved setting', async () => {
    const { fetchWorkflowAbandonedAutoCloseFn } = await import('@/lib/server/functions/settings')
    vi.mocked(fetchWorkflowAbandonedAutoCloseFn).mockResolvedValueOnce({
      enabled: true,
      waitMinutes: 15,
      keepIfEmailCaptured: false,
    } as never)

    renderWithClient(<AbandonedJourneyAutoCloseCard />)
    await waitFor(() =>
      expect(screen.getByLabelText('Auto-close abandoned journeys')).toBeChecked()
    )
    expect(screen.getByDisplayValue('15')).toBeInTheDocument()
    expect(screen.getByLabelText('Keep open if an email was captured')).not.toBeChecked()
  })

  it('saves through updateWorkflowAbandonedAutoCloseFn when the switch is toggled on', async () => {
    renderWithClient(<AbandonedJourneyAutoCloseCard />)
    const toggle = await screen.findByLabelText('Auto-close abandoned journeys')
    toggle.click()

    await waitFor(() =>
      expect(mockUpdateFn).toHaveBeenCalledWith({
        data: expect.objectContaining({ enabled: true }),
      })
    )
  })
})
