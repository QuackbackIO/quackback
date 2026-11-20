// @vitest-environment happy-dom
/**
 * A domain's own page sets up a section domain the way section domains are
 * hosted (`sectionDomainsCloud`), not the way billing is: a pooled workspace
 * whose projection has not landed is Cloud there, so the page never offers
 * the self-hosted hostname and check.
 */
import { cleanup, render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  context: {
    permissions: ['settings.custom_domain'] as string[],
    settings: { featureFlags: { feedback: true } },
    cloudEnabled: false,
    sectionDomainsCloud: false,
  },
  setup: null as null | { cloud: boolean },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    id: '/admin/settings/domains_/$domain',
    useLoaderData: () => ({
      sending: [],
      signIn: [],
      sectionDomains: { sectionDomains: {}, primaryHost: 'acme.com' },
      webAddresses: [],
      added: [],
      domain: { name: 'acme.com' },
    }),
    useParams: () => ({ domain: 'acme.com' }),
    useRouteContext: () => h.context,
  }),
  Navigate: () => null,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
}))
vi.mock('@/components/admin/settings/settings-page', () => ({
  SettingsPage: ({ children }: { children: unknown }) => children,
}))
vi.mock('@/components/admin/settings/domain-view', () => ({
  DomainView: ({ setup }: { setup: { cloud: boolean } }) => {
    h.setup = setup
    return null
  },
}))
vi.mock('@/components/admin/settings/domains-overview', () => ({
  domainRows: () => [{ name: 'acme.com' }],
}))
vi.mock('@/components/admin/settings/section-domains-card', () => ({
  listedSections: () => [],
}))

const { Route } = await import('../settings.domains_.$domain')
const DomainPage = (Route as unknown as { options: { component: ComponentType } }).options.component

afterEach(() => {
  cleanup()
  h.setup = null
})

describe('a domain page section domain setup', () => {
  it('is Cloud on a pooled workspace before its projection lands, though billing is not on', () => {
    h.context = { ...h.context, cloudEnabled: false, sectionDomainsCloud: true }
    render(<DomainPage />)
    expect(h.setup?.cloud).toBe(true)
  })

  it('is self-hosted on a self-hosted server', () => {
    h.context = { ...h.context, cloudEnabled: false, sectionDomainsCloud: false }
    render(<DomainPage />)
    expect(h.setup?.cloud).toBe(false)
  })
})
