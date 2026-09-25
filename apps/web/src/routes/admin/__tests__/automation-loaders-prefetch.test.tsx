// @vitest-environment happy-dom
/**
 * The AI & Automation route loaders warm the reads their page makes on load,
 * so the server-rendered page carries them and the browser does not fetch
 * them after hydration. The reads mounted here use the same query definitions
 * as the page's cards, so a read the loader misses shows up as a fetch on
 * mount.
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

vi.mock('@/lib/server/functions/assistant-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/assistant-settings')>()),
  getAssistantSettingsFn: stub('settings', {}),
}))
vi.mock('@/lib/server/functions/assistant-guidance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/assistant-guidance')>()),
  listGuidanceRulesFn: stub('guidanceRules', []),
  listAssistantToolsFn: stub('tools', []),
}))
vi.mock('@/lib/server/functions/assistant-guidance-stats', () => ({
  getGuidanceRuleStatsFn: stub('guidanceStats', {}),
}))
vi.mock('@/lib/server/functions/assistant-connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/assistant-connectors')>()),
  listConnectorsFn: stub('connectors', { connectors: [] }),
}))
vi.mock('@/lib/server/functions/workflows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/workflows')>()),
  listWorkflowsFn: stub('workflows', []),
}))
// Mocked so a warm-up of the run counts would show in the warmed list.
vi.mock('@/lib/server/functions/workflow-reporting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/workflow-reporting')>()),
  workflowEffectivenessFn: stub('effectiveness', []),
}))
vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  fetchWidgetConfig: stub('widgetConfig', {}),
  fetchWorkflowAbandonedAutoCloseFn: stub('abandonedAutoClose', {}),
  fetchWorkflowCloseSpamFn: stub('closeSpam', {}),
}))
vi.mock('@/lib/server/functions/entitlement-status', () => ({
  hasEntitlementFn: () => Promise.resolve(true),
}))

const { assistantQueries } = await import('@/lib/client/queries/assistant')
const { connectorQueries } = await import('@/lib/client/queries/assistant-connectors')
const { settingsQueries } = await import('@/lib/client/queries/settings')
const { workflowsQuery } = await import('@/lib/client/queries/workflows')

type Loader = (ctx: { context: Record<string, unknown> }) => Promise<unknown>
async function loaderOf(path: string): Promise<Loader> {
  const { Route } = await import(/* @vite-ignore */ path)
  return (Route as { options: { loader: Loader } }).options.loader
}

let client: QueryClient
beforeEach(() => {
  calls.length = 0
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Run a route's loader, then mount the page's reads and list what they fetched. */
async function fetchesAfterLoader(path: string, useReads: () => void, context = {}) {
  const loader = await loaderOf(path)
  await loader({
    context: {
      queryClient: client,
      billingEnabled: false,
      settings: { featureFlags: { supportInbox: true } },
      ...context,
    },
  })
  const warmed = [...calls].sort()
  calls.length = 0
  renderHook(useReads, { wrapper })
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return { warmed, afterMount: [...calls] }
}

/** The settings every tab edits and the always-mounted Guidance tab's card. */
function useAgentSettingsReads() {
  useQuery(assistantQueries.settings())
  useQuery(assistantQueries.guidanceRules())
  useQuery(assistantQueries.guidanceRuleStats())
}

describe('AI & Automation loaders', () => {
  it('/admin/automation warms the agent settings page a desktop moves on to', async () => {
    const { warmed, afterMount } = await fetchesAfterLoader(
      '@/routes/admin/automation.index',
      useAgentSettingsReads,
      { permissions: ['assistant.manage'] }
    )
    expect(afterMount).toEqual([])
    expect(warmed).toEqual(['guidanceRules', 'guidanceStats', 'settings'])
  })

  it('/admin/automation warms nothing for a viewer who cannot manage the agent', async () => {
    const loader = await loaderOf('@/routes/admin/automation.index')
    await loader({ context: { queryClient: client, permissions: ['analytics.view'] } })
    expect(calls).toEqual([])
  })

  it('/admin/automation/connectors warms the built-in tools card', async () => {
    const { warmed, afterMount } = await fetchesAfterLoader(
      '@/routes/admin/automation.connectors',
      () => {
        useQuery(connectorQueries.list())
        useQuery(assistantQueries.settings())
        useQuery(assistantQueries.tools())
      }
    )
    expect(afterMount).toEqual([])
    expect(warmed).toEqual(['connectors', 'settings', 'tools'])
  })

  it('/admin/automation/workflows warms the list and both toggles', async () => {
    const { warmed, afterMount } = await fetchesAfterLoader(
      '@/routes/admin/automation.workflows',
      () => {
        useQuery(workflowsQuery())
        useQuery(settingsQueries.widgetConfig())
        useQuery(settingsQueries.workflowAbandonedAutoClose())
        useQuery(settingsQueries.workflowCloseSpam())
      }
    )
    expect(afterMount).toEqual([])
    expect(warmed).toEqual(['abandonedAutoClose', 'closeSpam', 'widgetConfig', 'workflows'])
  })

  it('/admin/automation/workflows skips the page reads when the page redirects away', async () => {
    const loader = await loaderOf('@/routes/admin/automation.workflows')
    await loader({
      context: { queryClient: client, billingEnabled: false, settings: { featureFlags: {} } },
    })
    expect(calls).not.toContain('workflows')
    expect(calls).not.toContain('closeSpam')
  })
})
