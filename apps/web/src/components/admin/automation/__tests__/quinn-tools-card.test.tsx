// @vitest-environment happy-dom
/**
 * Smoke coverage for the Quinn tools & connectors card: renders the per-tool
 * breakdown from getQuinnToolMetricsFn and the connector health list from
 * getConnectorHealthFn (mocked), including the empty-connectors state.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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

const CONNECTOR_HEALTH = [
  {
    id: 'data_connector_1',
    name: 'Billing lookup',
    enabled: true,
    status: 'active' as const,
    failureCount: 0,
    lastError: null,
    healthStatus: 'healthy' as const,
  },
  {
    id: 'data_connector_2',
    name: 'Shipping status',
    enabled: true,
    status: 'active' as const,
    failureCount: 4,
    lastError: 'connect ETIMEDOUT',
    healthStatus: 'degraded' as const,
  },
  {
    id: 'data_connector_3',
    name: 'CRM sync',
    enabled: false,
    status: 'disabled' as const,
    failureCount: 50,
    lastError: 'HTTP 500',
    healthStatus: 'unhealthy' as const,
  },
]

const hoisted = vi.hoisted(() => ({
  getQuinnToolMetricsFn: vi.fn(),
  getConnectorHealthFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/assistant-tools-analytics', () => ({
  getQuinnToolMetricsFn: hoisted.getQuinnToolMetricsFn,
  getConnectorHealthFn: hoisted.getConnectorHealthFn,
}))

import { QuinnToolsCard } from '../quinn-tools-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('QuinnToolsCard', () => {
  it('mounts with no required props', () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue([])
    hoisted.getConnectorHealthFn.mockResolvedValue([])
    expect(() => renderWithClient(<QuinnToolsCard />)).not.toThrow()
  })

  it('renders each tool with its call count and success rate', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    hoisted.getConnectorHealthFn.mockResolvedValue([])
    renderWithClient(<QuinnToolsCard />)

    expect(await screen.findByText('search_kb')).toBeInTheDocument()
    expect(screen.getByText('refund_charge')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
  })

  it('shows the denied/duplicate count when nonzero', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    hoisted.getConnectorHealthFn.mockResolvedValue([])
    renderWithClient(<QuinnToolsCard />)

    await screen.findByText('search_kb')
    // refund_charge has 2 denied + 0 duplicate = 2
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders a connector badge for each health tier', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue([])
    hoisted.getConnectorHealthFn.mockResolvedValue(CONNECTOR_HEALTH)
    renderWithClient(<QuinnToolsCard />)

    expect(await screen.findByText('Billing lookup')).toBeInTheDocument()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('Degraded')).toBeInTheDocument()
    expect(screen.getByText('Unhealthy')).toBeInTheDocument()
  })

  it('shows an empty state when there are no connectors', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    hoisted.getConnectorHealthFn.mockResolvedValue([])
    renderWithClient(<QuinnToolsCard />)

    await screen.findByText('search_kb')
    expect(screen.getByText(/no connectors/i)).toBeInTheDocument()
  })

  it('shows a total actions headline tile', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    hoisted.getConnectorHealthFn.mockResolvedValue([])
    renderWithClient(<QuinnToolsCard />)

    await screen.findByText('search_kb')
    // 18 + 5 succeeded across both tools
    expect(screen.getByText('23')).toBeInTheDocument()
  })

  it('fetches the last-30-days range for tool metrics', async () => {
    hoisted.getQuinnToolMetricsFn.mockResolvedValue(TOOL_METRICS)
    hoisted.getConnectorHealthFn.mockResolvedValue([])
    renderWithClient(<QuinnToolsCard />)

    await screen.findByText('search_kb')
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
