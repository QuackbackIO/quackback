// @vitest-environment happy-dom
/**
 * Smoke coverage for the Quinn performance card: renders the five KPI tiles
 * from getQuinnPerformanceFn (involvement/resolution/escalation rates,
 * actions taken, and customer satisfaction), with the confirmed/assumed
 * split and a loading placeholder before data arrives.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const SUMMARY = {
  involvements: 4,
  conversations: 10,
  involvementRate: 40,
  resolvedConfirmed: 1,
  resolvedAssumed: 1,
  resolutionRate: 50,
  handedOff: 1,
  escalationRate: 25,
  actionsTaken: 3,
  csat: { avgRating: 4.5, responseCount: 2 },
  dailyTrend: [
    { date: '2026-06-01', involvements: 2, resolved: 1 },
    { date: '2026-06-02', involvements: 2, resolved: 1 },
  ],
}

vi.mock('@/lib/server/functions/assistant-analytics', () => ({
  getQuinnPerformanceFn: vi.fn(async () => SUMMARY),
}))

import { getQuinnPerformanceFn } from '@/lib/server/functions/assistant-analytics'
import { QuinnPerformanceCard } from '../quinn-performance-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </IntlProvider>
  )
}

describe('QuinnPerformanceCard', () => {
  it('mounts with no required props', () => {
    expect(() => renderWithClient(<QuinnPerformanceCard />)).not.toThrow()
  })

  it('renders the involvement, resolution, and escalation rates', async () => {
    renderWithClient(<QuinnPerformanceCard />)
    expect(await screen.findByText('40%')).toBeInTheDocument()
    expect(await screen.findByText('50%')).toBeInTheDocument()
    expect(await screen.findByText('25%')).toBeInTheDocument()
  })

  it('shows the confirmed vs assumed resolution split', async () => {
    renderWithClient(<QuinnPerformanceCard />)
    expect(await screen.findByText(/1 confirmed.*1 assumed/)).toBeInTheDocument()
  })

  it('shows actions taken', async () => {
    renderWithClient(<QuinnPerformanceCard />)
    expect(await screen.findByText('3')).toBeInTheDocument()
  })

  it('renders all five KPI tiles', async () => {
    renderWithClient(<QuinnPerformanceCard />)
    expect(await screen.findByText('Involvement rate')).toBeInTheDocument()
    expect(screen.getByText('Resolution rate')).toBeInTheDocument()
    expect(screen.getByText('Escalation rate')).toBeInTheDocument()
    expect(screen.getByText('Actions completed')).toBeInTheDocument()
    expect(screen.getByText('Customer satisfaction')).toBeInTheDocument()
  })

  it('shows the customer satisfaction average and rating count', async () => {
    renderWithClient(<QuinnPerformanceCard />)
    expect(await screen.findByText('4.50 / 5')).toBeInTheDocument()
    expect(screen.getByText('2 ratings')).toBeInTheDocument()
  })

  it('shows a loading placeholder before data arrives', () => {
    renderWithClient(<QuinnPerformanceCard />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('fetches the last-30-days range', async () => {
    renderWithClient(<QuinnPerformanceCard />)
    await screen.findByText('40%')
    expect(getQuinnPerformanceFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from: expect.any(String),
          to: expect.any(String),
        }),
      })
    )
  })
})
