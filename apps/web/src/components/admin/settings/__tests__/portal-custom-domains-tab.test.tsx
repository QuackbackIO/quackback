// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  domainLists: 0,
  sectionReads: 0,
  readyHostnames: [] as readonly string[],
  order: [] as string[],
  mutateResult: { projection: { canonicalOrigin: 'https://help.acme.com' } } as {
    projection: { canonicalOrigin: string }
    transferToken?: string
  },
  domains: [] as { hostname: string; readiness: string; isPrimary: boolean }[],
}))

vi.mock('@/lib/server/functions/cloud-identity', () => ({
  getCloudCustomDomainsFn: vi.fn(async () => {
    calls.domainLists++
    return calls.domains
  }),
  getCloudIdentityFn: vi.fn(async () => null),
  hasCustomDomainEntitlementFn: vi.fn(async () => true),
  mutateCloudCustomDomainFn: vi.fn(async () => calls.mutateResult),
  platformLabelFromHostname: (hostname: string) => hostname.split('.')[0],
  updateCloudIdentityFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/section-domains', () => ({
  getSectionDomainsFn: vi.fn(async () => {
    calls.sectionReads++
    return { sectionDomains: {}, primaryHost: 'acme.com' }
  }),
}))

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ featureFlags: { feedback: true }, portalConfig: {} }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/admin/settings/section-domains-card', () => ({
  listedSections: () => [],
  SectionDomainsCard: ({
    readyHostnames,
    onMakePrimary,
  }: {
    readyHostnames: readonly string[]
    onMakePrimary?: (hostname: string) => void
  }) => {
    calls.readyHostnames = readyHostnames
    return (
      <button type="button" onClick={() => onMakePrimary?.('help.acme.com')}>
        Make primary
      </button>
    )
  },
}))

vi.mock('@/components/admin/settings/domains-cards', () => ({
  DomainsCard: ({ onRefresh }: { onRefresh: (hostname: string) => void }) => (
    <button type="button" onClick={() => onRefresh('help.acme.com')}>
      Verify domain
    </button>
  ),
  QuackbackUrlCard: () => null,
}))

const { default: PortalCustomDomainsTab } = await import('../portal-custom-domains-tab')
const { portalCustomDomainsQueries } = await import('@/lib/client/queries/portal-custom-domains')

const PENDING = { hostname: 'help.acme.com', readiness: 'pending', isPrimary: false }
const READY = { ...PENDING, readiness: 'ready' }

let queryClient: QueryClient

function renderTab(onLeave?: () => void) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <PortalCustomDomainsTab cloud onLeave={onLeave} />
      </Suspense>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  calls.domainLists = 0
  calls.sectionReads = 0
  calls.order = []
  calls.domains = [PENDING]
  calls.mutateResult = { projection: { canonicalOrigin: 'https://help.acme.com' } }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the Custom domains tab on Cloud', () => {
  it('shows a domain that turned ready in a later read, without a reload of the page', async () => {
    renderTab()
    await screen.findByText('Make primary')
    expect(calls.readyHostnames).toEqual([])

    calls.domains = [READY]
    await act(() =>
      queryClient.refetchQueries({ queryKey: portalCustomDomainsQueries.tab(true).queryKey })
    )

    await waitFor(() => expect(calls.readyHostnames).toEqual(['help.acme.com']))
  })

  it('reads the domain list once after a change', async () => {
    renderTab()
    fireEvent.click(await screen.findByText('Verify domain'))
    await waitFor(() => expect(calls.sectionReads).toBe(2))
    // The first read, then the one refetch the change asks for.
    expect(calls.domainLists).toBe(2)
  })

  it('lets the page drop its unsaved-changes guard before moving the session to the new primary domain', async () => {
    calls.mutateResult = {
      projection: { canonicalOrigin: 'https://help.acme.com' },
      transferToken: 'ott_1',
    }
    const assign = vi.fn(() => calls.order.push('assign'))
    vi.stubGlobal('location', { ...window.location, assign })
    const onLeave = vi.fn(() => calls.order.push('leave'))
    renderTab(onLeave)

    fireEvent.click(await screen.findByText('Make primary'))

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(calls.order).toEqual(['leave', 'assign'])
  })
})
