// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const hoisted = vi.hoisted(() => ({ support: vi.fn() }))

vi.mock('@/lib/server/functions/support-reporting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/support-reporting')>()),
  supportReportingFn: hoisted.support,
}))

import { AnalyticsSlaCards } from '../analytics-sla-cards'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const RANGE = { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' }

const clock = (met: number, breached: number) => ({
  met,
  breached,
  rate: met + breached > 0 ? met / (met + breached) : null,
})
const miss = (count: number, avgOverdueSecs: number | null) => ({ count, avgOverdueSecs })

const REPORT = {
  sla: {
    firstResponse: clock(9, 1),
    nextResponse: clock(0, 0),
    resolution: clock(3, 1),
    timeToResolve: clock(1, 1),
  },
  slaByPolicy: [
    {
      policyId: 'p1',
      policyName: 'Priority',
      firstResponse: clock(4, 0),
      nextResponse: clock(0, 0),
      resolution: clock(1, 1),
      timeToResolve: clock(0, 0),
    },
  ],
  slaHeatmap: [{ dow: 2, hour: 9, count: 3 }],
  slaTimeAfterMiss: {
    firstResponse: miss(1, 600),
    nextResponse: miss(0, null),
    resolution: miss(0, null),
    timeToResolve: miss(0, null),
  },
  workflows: [
    { workflowId: 'w1', started: 10, completed: 6, interrupted: 3, waiting: 1 },
    { workflowId: 'w2', started: 5, completed: 5, interrupted: 0, waiting: 0 },
  ],
}

function renderCards() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsSlaCards range={RANGE} />
    </QueryClientProvider>
  )
}

describe('AnalyticsSlaCards', () => {
  it('tables attainment per clock with met and missed counts', async () => {
    hoisted.support.mockResolvedValue(REPORT)
    renderCards()
    await screen.findByText('SLA attainment')
    const first = screen.getAllByRole('cell', { name: 'First response' })[0].closest('tr')!
    expect(Array.from(first.querySelectorAll('td')).map((c) => c.textContent)).toEqual([
      'First response',
      '9',
      '1',
      '90%',
    ])
    // A clock with nothing tracked reads as a hyphen, not 0%.
    const next = screen.getAllByRole('cell', { name: 'Next response' })[0].closest('tr')!
    expect(next.textContent).toContain('-')
    expect(next.textContent).not.toContain('0%')
  })

  it('asks the server for the range it is given', async () => {
    hoisted.support.mockResolvedValue(REPORT)
    renderCards()
    await screen.findByText('SLA attainment')
    expect(hoisted.support.mock.calls[0][0]).toEqual({ data: RANGE })
  })

  it('shows attainment per policy', async () => {
    hoisted.support.mockResolvedValue(REPORT)
    renderCards()
    const row = (await screen.findByText('Priority')).closest('tr')!
    expect(row.textContent).toContain('100%')
    expect(row.textContent).toContain('50%')
  })

  it('totals workflow runs by outcome', async () => {
    hoisted.support.mockResolvedValue(REPORT)
    renderCards()
    const runs = (await screen.findByText('Workflow runs')).closest(
      '[data-slot="card"]'
    ) as HTMLElement
    const rowOf = (label: string) => within(runs).getByText(label).closest('tr')!.textContent
    expect(rowOf('Started')).toContain('15')
    expect(rowOf('Completed')).toContain('11')
    expect(rowOf('Interrupted')).toContain('3')
  })

  it('draws the breaches by hour and the time after a miss', async () => {
    hoisted.support.mockResolvedValue(REPORT)
    const { container } = renderCards()
    expect(await screen.findByText('Breaches by hour')).toBeInTheDocument()
    expect(container.querySelector('[title^="Tue 09:00"]')).not.toBeNull()
    expect(screen.getByText('Time after a miss')).toBeInTheDocument()
  })

  it('says so when no breach was recorded', async () => {
    hoisted.support.mockResolvedValue({ ...REPORT, slaHeatmap: [] })
    renderCards()
    expect(await screen.findByText('No breaches in this period')).toBeInTheDocument()
  })
})
