// @vitest-environment happy-dom
/** Smoke coverage for the Quinn action performance card. */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const TOOL_METRICS = [
  {
    toolName: 'search_kb',
    succeeded: 18,
    failed: 2,
    denied: 0,
    skippedDuplicate: 1,
    successRate: 90,
    avgLatencyMs: 420,
  },
  {
    toolName: 'refund_charge',
    succeeded: 5,
    failed: 0,
    denied: 2,
    skippedDuplicate: 0,
    successRate: 60,
    avgLatencyMs: 800,
  },
]

const hoisted = vi.hoisted(() => ({
  getQuinnToolMetricsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/assistant-tools-analytics', () => ({
  getQuinnToolMetricsFn: hoisted.getQuinnToolMetricsFn,
}))

import { QuinnToolsCard } from '../quinn-tools-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </IntlProvider>
  )
}

describe('QuinnToolsCard', () => {
  it('mounts with no required props', () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue([])
    expect(() => renderWithClient(<QuinnToolsCard />)).not.toThrow()
  })

  it('uses customer-facing action labels rather than internal tool names', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    renderWithClient(<QuinnToolsCard />)

    expect((await screen.findAllByText('Action')).length).toBeGreaterThan(1)
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.queryByText('search_kb')).not.toBeInTheDocument()
  })

  it('shows the denied/duplicate count when nonzero', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    renderWithClient(<QuinnToolsCard />)

    await screen.findAllByText('Action')
    // refund_charge has 2 denied + 0 duplicate = 2
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('shows a total actions headline tile', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    renderWithClient(<QuinnToolsCard />)

    await screen.findAllByText('Action')
    // 18 + 5 succeeded across both tools
    expect(screen.getByText('23')).toBeInTheDocument()
  })

  it('fetches the last-30-days range for tool metrics', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    renderWithClient(<QuinnToolsCard />)

    await screen.findAllByText('Action')
    expect(hoisted.getQuinnToolMetricsFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from: expect.any(String),
          to: expect.any(String),
        }),
      })
    )
  })
})
