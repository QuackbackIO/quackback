// @vitest-environment happy-dom
/**
 * The operations card tells the truth about an empty range
 * (QUINN-PRODUCT Step 11, P8).
 *
 * The specification's own acceptance line: an empty page explains the next
 * useful step without fabricated metrics. A grid of 0% over a workspace that
 * has never run Quinn is exactly the fabricated metric it means, so the card is
 * asserted to print none of it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const EMPTY = {
  runs: {
    runs: 0,
    published: 0,
    failed: 0,
    superseded: 0,
    suppressed: 0,
    cancelled: 0,
    open: 0,
    failureRate: null,
    supersessionRate: null,
    unsupported: 0,
    unsupportedRate: null,
    queueToStartP50Ms: null,
    queueToStartP95Ms: null,
    totalP50Ms: null,
  },
  steps: [],
  actions: {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    unknown: 0,
    denied: 0,
    successRate: null,
    unknownRate: null,
    awaitingReconciliation: 0,
  },
  approvals: {
    proposed: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    executed: 0,
    decisionRate: null,
    completionRate: null,
    owed: 0,
  },
}

const REAL = {
  ...EMPTY,
  runs: {
    ...EMPTY.runs,
    runs: 8,
    published: 6,
    failed: 2,
    failureRate: 25,
    unsupported: 1,
    unsupportedRate: 12.5,
    queueToStartP50Ms: 1_400,
    queueToStartP95Ms: 4_200,
    totalP50Ms: 9_000,
    open: 1,
  },
  steps: [{ step: 'generate', runs: 6, p50Ms: 5_000 }],
  actions: {
    ...EMPTY.actions,
    attempted: 4,
    succeeded: 3,
    unknown: 1,
    successRate: 75,
    unknownRate: 25,
    awaitingReconciliation: 1,
  },
}

const getQuinnOperationsFn = vi.fn()
vi.mock('@/lib/server/functions/assistant-operations-analytics', () => ({
  getQuinnOperationsFn: (...args: unknown[]) => getQuinnOperationsFn(...args),
}))

import { QuinnOperationsCard } from '../quinn-operations-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('QuinnOperationsCard', () => {
  it('explains the next step instead of printing zeroes for a workspace with no runs', async () => {
    getQuinnOperationsFn.mockResolvedValue(EMPTY)
    renderWithClient(<QuinnOperationsCard />)
    expect(await screen.findByText(/Quinn has not run in the last 30 days/)).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
  })

  it('renders the real rates and timings when there is work to report', async () => {
    getQuinnOperationsFn.mockResolvedValue(REAL)
    renderWithClient(<QuinnOperationsCard />)
    expect(await screen.findByText('25%')).toBeInTheDocument()
    expect(screen.getByText('1.4s')).toBeInTheDocument()
    expect(screen.getByText('9.0s')).toBeInTheDocument()
    // An unconfirmed effect is a count, never a rate dressed up as success.
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument()
    expect(screen.getByText('1 awaiting a verdict')).toBeInTheDocument()
  })

  it('shows a dash for a rate it has no denominator for', async () => {
    getQuinnOperationsFn.mockResolvedValue({
      ...REAL,
      approvals: { ...EMPTY.approvals },
    })
    renderWithClient(<QuinnOperationsCard />)
    expect(await screen.findByText('25%')).toBeInTheDocument()
    // Approvals were never proposed, so both approval rates read as unknown.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
})
