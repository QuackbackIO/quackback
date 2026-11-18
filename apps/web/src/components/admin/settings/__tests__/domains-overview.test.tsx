// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    hash,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
    hash?: string
    children: ReactNode
  }) => (
    <a
      href={`${to.replace(/\$(\w+)/g, (_, key: string) => params?.[key] ?? '')}${search ? `?${new URLSearchParams(search).toString()}` : ''}${hash ? `#${hash}` : ''}`}
      {...rest}
    >
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

const { VerifiedDomainsCard, EMPTY_DESCRIPTION, VERIFIED_DOMAINS_TITLE, domainRows } =
  await import('../domains-overview')

/** The Verified domains card with these rows, for a viewer who can add a domain. */
const DomainList = ({ rows, links }: { rows: DomainRows; links: Links }) => (
  <VerifiedDomainsCard rows={rows} links={links} canAdd />
)
type DomainRows = ReturnType<typeof domainRows>
type Links = ReturnType<typeof domainUseLinks>
const { domainUseLinks } = await import('@/lib/shared/domains-permissions')

afterEach(cleanup)

const NOW = new Date('2026-11-03T12:00:00.000Z')
const VERIFIED = '2026-11-01T00:00:00.000Z'

const sending = (over: Partial<Parameters<typeof domainRows>[0]['sending'][0]>) => ({
  id: 'sending_domain_1',
  domain: 'acme.com',
  status: 'verified',
  verifiedAt: '2026-11-01T00:00:00.000Z',
  autoCheckUntil: null,
  localParts: [],
  ownershipProven: false,
  ...over,
})

const ALL = [
  PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  EMAIL_SENDING_PERMISSION,
  PERMISSIONS.AUTH_MANAGE,
  PERMISSIONS.HELP_CENTER_MANAGE,
]

const linksFor = (permissions: string[]) => domainUseLinks({ permissions })

const rowOf = (text: string) => screen.getByText(text).closest('[data-slot="settings-list-row"]')!

vi.mock('@/lib/server/functions/domains', () => ({ addDomainFn: vi.fn() }))

describe('Verified domains card', () => {
  it('is titled Verified domains, with Add domain on the card', () => {
    render(<VerifiedDomainsCard rows={[]} links={linksFor(ALL)} canAdd />)
    expect(screen.getByRole('heading', { name: VERIFIED_DOMAINS_TITLE })).toHaveTextContent(
      'Verified domains'
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Add domain' })).toBeInTheDocument()
  })

  it('with none yet, says what a verified domain is for, and no choice of use', () => {
    const { container } = render(<VerifiedDomainsCard rows={[]} links={linksFor(ALL)} canAdd />)
    expect(container).toHaveTextContent(EMPTY_DESCRIPTION)
    expect(screen.queryByRole('link')).toBeNull()
    for (const use of [
      'Email sending',
      'Custom domains',
      'Sign-in',
      'Security',
      'No domains yet',
    ]) {
      expect(container).not.toHaveTextContent(use)
    }
  })

  it('offers no Add domain to a viewer who cannot add one', () => {
    const { container } = render(
      <VerifiedDomainsCard rows={[]} links={linksFor(ALL)} canAdd={false} />
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(container).toHaveTextContent(EMPTY_DESCRIPTION)
  })

  it('leaves section hostnames to the Custom domains card: no row, and no Custom domain chip', () => {
    const rows = domainRows({
      now: NOW,
      sending: [sending({})],
      signIn: [],
      sectionDomains: {
        help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
        status: { hostname: 'status.example.org', verifiedAt: null },
      },
      webAddresses: [{ hostname: 'feedback.example.net', readiness: 'ready' }],
      added: [{ name: 'acme.com', verified: true }],
    })
    const { container } = render(<DomainList rows={rows} links={linksFor(ALL)} />)
    const listed = [...container.querySelectorAll('[data-slot="settings-list-row"]')]
    expect(listed.map((r) => r.querySelector('span.font-medium')?.textContent)).toEqual([
      'acme.com',
    ])
    expect(rowOf('acme.com')).toHaveTextContent('Email')
    expect(container).not.toHaveTextContent('Custom domain')
    expect(container).not.toHaveTextContent('help.acme.com')
  })
})

describe('use links', () => {
  it('gates each use on the permission of the page it opens', () => {
    expect(Object.keys(linksFor([EMAIL_SENDING_PERMISSION]))).toEqual(['email'])
    expect(Object.keys(linksFor([PERMISSIONS.AUTH_MANAGE]))).toEqual(['signIn'])
    expect(Object.keys(linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN]))).toEqual(['customDomain'])
    // Help center access alone sets up no custom domain: they are written on Settings > Portal.
    expect(linksFor([PERMISSIONS.HELP_CENTER_MANAGE]).customDomain).toBeUndefined()
  })

  it('lands Custom domain on the Custom domains tab of Settings > Portal, on Cloud and self-hosted', () => {
    const links = linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN])
    expect(links.customDomain).toEqual({
      to: '/admin/settings/portal',
      search: { tab: 'custom-domains' },
    })
  })

  it('opens email and sign-in on their own pages', () => {
    const links = linksFor(ALL)
    expect(links.email).toEqual({ to: '/admin/settings/email' })
    expect(links.signIn).toEqual({
      to: '/admin/settings/security/authentication',
      search: { tab: 'sign-in' },
    })
  })
})

describe('domain list', () => {
  it('shows a domain used for email and sign-in as one row with two chips', () => {
    const rows = domainRows({
      now: NOW,
      sending: [sending({ localParts: ['billing@', 'help@'] })],
      signIn: [{ id: 'domain_a', name: 'acme.com', verified: true, provenBy: null }],
    })
    render(<DomainList rows={rows} links={linksFor(ALL)} />)

    expect(screen.getAllByText('acme.com')).toHaveLength(1)
    const row = rowOf('acme.com')
    expect(within(row as HTMLElement).getByText('Email')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('Sign-in')).toBeInTheDocument()
    expect(row).toHaveTextContent('billing@, help@')
    // Healthy uses show no status badge.
    expect(row).not.toHaveTextContent('Pending')
    expect(row).not.toHaveTextContent('Needs attention')
    expect(row).toHaveAttribute('href', '/admin/settings/domains/acme.com')
  })

  it('lists each domain once, in name order, with its status words', () => {
    const rows = domainRows({
      now: NOW,
      sending: [
        sending({ ownershipProven: true }),
        sending({
          id: 'sending_domain_2',
          domain: 'acme.co.uk',
          status: 'pending',
          verifiedAt: null,
          autoCheckUntil: '2026-11-05T00:00:00.000Z',
          localParts: ['updates@'],
        }),
        sending({ id: 'sending_domain_3', domain: 'example.org', status: 'failed' }),
      ],
      signIn: [
        { id: 'domain_b', name: 'example.net', verified: false, provenBy: null },
        { id: 'domain_c', name: 'eu.acme.com', verified: false, provenBy: 'email-sending' },
        { id: 'domain_d', name: 'example.io', verified: true, provenBy: 'workspace' },
      ],
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: null } },
    })
    render(<DomainList rows={rows} links={linksFor(ALL)} />)

    expect(rows.map((r) => r.name)).toEqual([
      'acme.co.uk',
      'acme.com',
      'eu.acme.com',
      'example.io',
      'example.net',
      'example.org',
      'help.acme.com',
    ])
    // The list itself leaves the section hostname to the Custom domains card.
    expect(screen.queryByText('help.acme.com')).toBeNull()

    expect(rowOf('acme.com')).toHaveTextContent('Domain verified')
    expect(rowOf('acme.co.uk')).toHaveTextContent('Pending')
    expect(rowOf('example.org')).toHaveTextContent('Needs attention')

    const pendingSignIn = rowOf('example.net')
    expect(pendingSignIn).toHaveTextContent('Sign-in')
    expect(pendingSignIn).toHaveTextContent('Pending')
    expect(pendingSignIn).toHaveAttribute('href', '/admin/settings/domains/example.net')
    expect(rowOf('eu.acme.com')).toHaveTextContent('Already verified. Click Verify to use it.')
    expect(rowOf('example.io')).toHaveTextContent('Verified by this workspace')
    expect(rowOf('example.io')).not.toHaveTextContent('Pending')
  })

  it('opens the domain, not one of its uses, when a domain has more than one', () => {
    const rows = domainRows({
      now: NOW,
      sending: [sending({})],
      signIn: [{ id: 'domain_a', name: 'ACME.com', verified: false, provenBy: null }],
    })
    render(<DomainList rows={rows} links={linksFor(ALL)} />)
    const row = rowOf('acme.com')
    expect(row).toHaveTextContent('Pending')
    expect(row).toHaveAttribute('href', '/admin/settings/domains/acme.com')
  })

  it('links a row for a viewer who can open one of its uses, whichever it is', () => {
    const rows = domainRows({
      now: NOW,
      sending: [sending({})],
      signIn: [{ id: 'domain_a', name: 'acme.com', verified: true, provenBy: null }],
    })
    render(<DomainList rows={rows} links={linksFor([PERMISSIONS.AUTH_MANAGE])} />)
    expect(rowOf('acme.com')).toHaveAttribute('href', '/admin/settings/domains/acme.com')
  })

  it('renders a row without a link for a viewer who cannot open its page', () => {
    const rows = domainRows({ now: NOW, sending: [sending({})], signIn: [] })
    render(<DomainList rows={rows} links={linksFor([PERMISSIONS.AUTH_MANAGE])} />)
    const row = rowOf('acme.com')
    expect(row.tagName).not.toBe('A')
    expect(row.querySelector('[data-slot="settings-list-chevron"]')).toBeNull()
    expect(row).not.toHaveTextContent('Pending')
  })

  it('lists a domain added by name with no use, pending until verified, linked to its page', () => {
    const rows = domainRows({
      now: NOW,
      sending: [sending({})],
      signIn: [],
      added: [
        { name: 'acme.io', verified: false },
        { name: 'acme.net', verified: true },
        // Added and used: one row, its uses say where it stands.
        { name: 'acme.com', verified: false },
      ],
    })
    expect(rows.map((r) => [r.name, r.uses.map((u) => u.use)])).toEqual([
      ['acme.com', ['email']],
      ['acme.io', []],
      ['acme.net', []],
    ])
    // A sign-in manager sees the domain too, and can open its page.
    render(<DomainList rows={rows} links={linksFor([PERMISSIONS.AUTH_MANAGE])} />)
    expect(rowOf('acme.io')).toHaveTextContent('Pending')
    expect(rowOf('acme.io')).toHaveAttribute('href', '/admin/settings/domains/acme.io')
    // Verified is the normal state: no badge.
    expect(rowOf('acme.net')).not.toHaveTextContent('Pending')
    expect(rowOf('acme.com')).not.toHaveTextContent('Pending')
  })

  it('rows custom domains under a domain already added on that domain, for its own page', () => {
    const rows = domainRows({
      now: NOW,
      sending: [],
      signIn: [],
      webAddresses: [
        { hostname: 'status.acme.com', readiness: 'ready' },
        { hostname: 'help.acme.com', readiness: 'pending' },
        // Shares a suffix only: its own row.
        { hostname: 'help.notacme.com', readiness: 'ready' },
      ],
      added: [{ name: 'acme.com', verified: true }],
    })
    expect(rows.map((r) => r.name)).toEqual(['acme.com', 'help.notacme.com'])
    const [web] = rows[0]!.uses
    expect(web).toMatchObject({ use: 'customDomain', state: 'pending' })
    expect(web!.addresses).toEqual([
      { hostname: 'help.acme.com', usedFor: 'portal', state: 'pending' },
      { hostname: 'status.acme.com', usedFor: 'portal', state: null },
    ])
    expect(web!.detail).toBe('help.acme.com · Portal, status.acme.com · Portal')
  })

  it("lists the help center's address under the domain it sits on", () => {
    const rows = domainRows({
      now: NOW,
      sending: [],
      signIn: [],
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      added: [{ name: 'acme.com', verified: true }],
    })
    expect(rows.map((r) => r.name)).toEqual(['acme.com'])
    expect(rows[0]!.uses[0]!.addresses).toEqual([
      { hostname: 'help.acme.com', usedFor: 'help', state: null },
    ])
    expect(rows[0]!.uses[0]!.detail).toBe('help.acme.com · Help center')
  })

  it("rows a Cloud web address as its domain's custom domain use", () => {
    const rows = domainRows({
      now: NOW,
      sending: [],
      signIn: [],
      webAddresses: [
        { hostname: 'feedback.acme.com', readiness: 'ready' },
        { hostname: 'help.acme.com', readiness: 'pending' },
        { hostname: 'status.acme.com', readiness: 'failed' },
      ],
      added: [{ name: 'feedback.acme.com', verified: false }],
    })
    expect(rows.map((r) => [r.name, r.uses.map((u) => [u.use, u.state])])).toEqual([
      ['feedback.acme.com', [['customDomain', null]]],
      ['help.acme.com', [['customDomain', 'pending']]],
      ['status.acme.com', [['customDomain', 'attention']]],
    ])
  })

  it('names what each Cloud custom domain is used for: its section, else the portal', () => {
    const rows = domainRows({
      now: NOW,
      sending: [],
      signIn: [],
      webAddresses: [
        { hostname: 'help.acme.com', readiness: 'ready' },
        { hostname: 'feedback.acme.com', readiness: 'ready' },
      ],
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      added: [{ name: 'acme.com', verified: true }],
    })
    expect(rows[0]!.uses[0]!.addresses).toEqual([
      { hostname: 'feedback.acme.com', usedFor: 'portal', state: null },
      { hostname: 'help.acme.com', usedFor: 'help', state: null },
    ])
    expect(rows[0]!.uses[0]!.detail).toBe('feedback.acme.com · Portal, help.acme.com · Help center')
  })

  it('lists every section domain under its domain, a host that stopped answering needing attention', () => {
    const rows = domainRows({
      now: NOW,
      sending: [],
      signIn: [],
      sectionDomains: {
        help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
        status: {
          hostname: 'status.acme.com',
          verifiedAt: VERIFIED,
          unconfirmedSince: VERIFIED,
        },
        changelog: { hostname: 'news.acme.com', verifiedAt: null },
      },
      added: [{ name: 'acme.com', verified: true }],
    })
    expect(rows.map((r) => r.name)).toEqual(['acme.com'])
    const [web] = rows[0]!.uses
    expect(web).toMatchObject({ use: 'customDomain', state: 'attention' })
    expect(web!.addresses).toEqual([
      { hostname: 'help.acme.com', usedFor: 'help', state: null },
      { hostname: 'news.acme.com', usedFor: 'changelog', state: 'pending' },
      { hostname: 'status.acme.com', usedFor: 'status', state: 'attention' },
    ])
  })
})
