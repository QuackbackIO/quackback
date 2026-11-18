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
  mutateResult: { projection: { canonicalOrigin: 'https://help.acme.com' } } as
    | { projection: { canonicalOrigin: string }; transferToken?: string }
    | { ok: false; code: string; message: string },
  domains: [] as { hostname: string; readiness: string; isPrimary: boolean }[],
  permissions: [] as string[],
  navigate: vi.fn(),
  sectionDomains: {} as Record<string, { hostname: string; verifiedAt: string | null }>,
  usedBySection: undefined as ((hostname: string) => boolean) | undefined,
  card: {} as {
    cloudHostnames?: readonly string[]
    loadVerifiedDomains?: () => Promise<readonly string[]>
    loadCloudRecords?: (hostname: string) => Promise<unknown[]>
    onAddVerifiedDomain?: (section: string) => void
  },
}))

vi.mock('@/lib/server/functions/domains', () => ({
  listDomainsFn: vi.fn(async () => [
    { name: 'acme.com', verified: true },
    { name: 'pending.org', verified: false },
    { name: 'acme.io', verified: true },
  ]),
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
    return { sectionDomains: calls.sectionDomains, primaryHost: 'acme.com' }
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: calls.navigate }),
}))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ featureFlags: { feedback: true }, portalConfig: {} }),
  useHasPermission: (permission: string) => calls.permissions.includes(permission),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/admin/settings/section-domains-card', () => ({
  listedSections: () => [],
  SectionDomainsCard: ({
    readyHostnames,
    onMakePrimary,
    ...rest
  }: {
    readyHostnames: readonly string[]
    onMakePrimary?: (hostname: string) => void
    cloudHostnames?: readonly string[]
    loadVerifiedDomains?: () => Promise<readonly string[]>
    onAddVerifiedDomain?: (section: string) => void
  }) => {
    calls.readyHostnames = readyHostnames
    calls.card = rest
    return (
      <button type="button" onClick={() => onMakePrimary?.('help.acme.com')}>
        Make primary
      </button>
    )
  },
}))

vi.mock('@/components/admin/settings/domains-cards', () => ({
  DomainsCard: ({
    onRefresh,
    usedBySection,
  }: {
    onRefresh: (hostname: string) => void
    usedBySection?: (hostname: string) => boolean
  }) => {
    calls.usedBySection = usedBySection
    return (
      <button type="button" onClick={() => onRefresh('help.acme.com')}>
        Verify domain
      </button>
    )
  },
  QuackbackUrlCard: () => null,
  hostnameRecords: (domain: { hostname: string }) => [{ name: domain.hostname }],
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
  calls.permissions = []
  calls.navigate.mockReset()
  calls.card = {}
  calls.sectionDomains = {}
  calls.usedBySection = undefined
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

  it('tells the Domain verification card which domains a section uses', async () => {
    calls.sectionDomains = { help: { hostname: 'help.acme.com', verifiedAt: null } }
    renderTab()
    await screen.findByText('Verify domain')
    expect(calls.usedBySection?.('help.acme.com')).toBe(true)
    expect(calls.usedBySection?.('feedback.acme.com')).toBe(false)
  })

  it('says why Make primary was refused, and leaves the page where it is', async () => {
    calls.mutateResult = {
      ok: false,
      code: 'CUSTOM_DOMAIN_USED_BY_SECTION',
      message: 'Help center uses this domain. Remove it there first.',
    }
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const onLeave = vi.fn()
    const { toast } = await import('sonner')
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.success).mockClear()
    renderTab(onLeave)

    fireEvent.click(await screen.findByText('Make primary'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Help center uses this domain. Remove it there first.'
      )
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    expect(onLeave).not.toHaveBeenCalled()
  })
})

describe('the Custom domains tab: Verified domains for the dialog', () => {
  it('hands the dialog the Verified domains only, and every Cloud custom domain', async () => {
    renderTab()
    await screen.findByText('Make primary')
    expect(calls.card.cloudHostnames).toEqual(['help.acme.com'])
    await expect(calls.card.loadVerifiedDomains?.()).resolves.toEqual(['acme.com', 'acme.io'])
  })

  it("reads a Cloud custom domain's records fresh for the DNS step", async () => {
    renderTab()
    await screen.findByText('Make primary')
    const reads = calls.domainLists
    await expect(calls.card.loadCloudRecords?.('help.acme.com')).resolves.toEqual([
      { name: 'help.acme.com' },
    ])
    expect(calls.domainLists).toBe(reads + 1)
    await expect(calls.card.loadCloudRecords?.('other.acme.com')).resolves.toEqual([])
  })

  it('sends a viewer who may add a domain to Add domain on Settings > Domains', async () => {
    calls.permissions = ['settings.manage']
    renderTab()
    await screen.findByText('Make primary')
    calls.card.onAddVerifiedDomain?.('help')
    expect(calls.navigate).toHaveBeenCalledWith({
      to: '/admin/settings/domains',
      search: { add: '1', for: 'help' },
    })
  })

  it('never links a viewer who cannot add a domain there', async () => {
    calls.permissions = ['settings.custom_domain']
    renderTab()
    await screen.findByText('Make primary')
    expect(calls.card.onAddVerifiedDomain).toBeUndefined()
  })
})
