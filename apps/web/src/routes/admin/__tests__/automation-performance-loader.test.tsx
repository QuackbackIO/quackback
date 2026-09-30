// @vitest-environment happy-dom
/**
 * The AI performance route loader fixes the 30-day window once, warms every
 * card's read for it and hands it to the cards, so the server-rendered page
 * carries the cards' data and the browser fetches nothing more for them. The
 * window is part of each card's query key: a card that picked its own window
 * would miss the warm cache and fetch again.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
function stub<T>(name: string, value: T) {
  return () => {
    calls.push(name)
    return Promise.resolve(value)
  }
}

vi.mock('@/lib/server/functions/assistant-analytics', () => ({
  getQuinnPerformanceFn: stub('quinnPerformance', {}),
}))
vi.mock('@/lib/server/functions/assistant-tools-analytics', () => ({
  getQuinnToolMetricsFn: stub('quinnTools', []),
}))
vi.mock('@/lib/server/functions/assistant-copilot-analytics', () => ({
  getCopilotUsageMetricsFn: stub('copilotUsage', {}),
}))
vi.mock('@/lib/server/functions/support-reporting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/support-reporting')>()),
  supportReportingFn: stub('supportReporting', {
    sla: {},
    slaByPolicy: [],
    slaHeatmap: [],
    slaTimeAfterMiss: {},
    workflows: [],
  }),
}))

const { Route } = await import('@/routes/admin/automation.performance')
const { quinnPerformanceQuery } = await import('@/lib/client/queries/assistant-analytics')
const { quinnToolMetricsQuery } = await import('@/lib/client/queries/assistant-tools-analytics')
const { copilotUsageMetricsQuery } =
  await import('@/lib/client/queries/assistant-copilot-analytics')
const { supportReportingQuery } = await import('@/lib/client/queries/support-reporting')

type Range = { from: string; to: string }
type LoaderFn = (ctx: { context: { queryClient: QueryClient } }) => Promise<{ range: Range }>
const loader = (Route as unknown as { options: { loader: LoaderFn } }).options.loader

/** The four cards' reads, for the window the page hands them. */
function useCardReads(range: Range) {
  useQuery(quinnPerformanceQuery(range.from, range.to))
  useQuery(quinnToolMetricsQuery(range.from, range.to))
  useQuery(copilotUsageMetricsQuery(range.from, range.to))
  useQuery(supportReportingQuery(range.from, range.to))
}

let client: QueryClient
beforeEach(() => {
  calls.length = 0
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('/admin/automation/performance loader', () => {
  it('warms every card for the 30-day window it hands them', async () => {
    const { range } = await loader({ context: { queryClient: client } })

    expect(new Date(range.to).getTime() - new Date(range.from).getTime()).toBe(30 * 86_400_000)
    // One read per card: the support card's SLA and workflow figures come
    // back in a single request.
    expect([...calls].sort()).toEqual(
      ['copilotUsage', 'quinnPerformance', 'quinnTools', 'supportReporting'].sort()
    )

    calls.length = 0
    renderHook(() => useCardReads(range), { wrapper })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(calls).toEqual([])
  })

  it('still renders the page when a card read fails', async () => {
    const failing = vi
      .spyOn(client, 'ensureQueryData')
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))

    await expect(loader({ context: { queryClient: client } })).resolves.toHaveProperty('range')
    failing.mockRestore()
  })
})
