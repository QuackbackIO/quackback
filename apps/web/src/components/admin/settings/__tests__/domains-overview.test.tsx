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

const { DomainList, DomainsEmptyState, EMPTY_DESCRIPTION, domainRows } =
  await import('../domains-overview')
const { domainUseLinks, CUSTOM_DOMAINS_ANCHOR } = await import('@/lib/shared/domains-permissions')

afterEach(cleanup)

const NOW = new Date('2026-11-03T12:00:00.000Z')

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

const linksFor = (permissions: string[], { cloudEnabled = false, helpCenterOn = true } = {}) =>
  domainUseLinks({ permissions, cloudEnabled, helpCenterOn })

const rowOf = (text: string) => screen.getByText(text).closest('[data-slot="settings-list-row"]')!

vi.mock('@/lib/server/functions/domains', () => ({ addDomainFn: vi.fn() }))

describe('empty state', () => {
  it('offers one Add domain action and no choice of use', () => {
    const { container } = render(<DomainsEmptyState canAdd />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Add domain' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(container).toHaveTextContent(EMPTY_DESCRIPTION)
    for (const use of ['Email sending', 'Custom domain', 'Sign-in']) {
      expect(container).not.toHaveTextContent(use)
    }
  })

  it('never says Security, and is no dead end for a viewer who can add', () => {
    const { container } = render(<DomainsEmptyState canAdd />)
    expect(container).not.toHaveTextContent('Security')
    expect(container).not.toHaveTextContent('No domains yet')
  })

  it('offers no Add domain to a viewer who cannot add one', () => {
    const { container } = render(<DomainsEmptyState canAdd={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(container).toHaveTextContent(EMPTY_DESCRIPTION)
  })
})

describe('use links', () => {
  it('gates each use on the permission of the page it opens', () => {
    expect(Object.keys(linksFor([EMAIL_SENDING_PERMISSION]))).toEqual(['email'])
    expect(Object.keys(linksFor([PERMISSIONS.AUTH_MANAGE]))).toEqual(['signIn'])
    expect(
      Object.keys(linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN, PERMISSIONS.HELP_CENTER_MANAGE]))
    ).toEqual(['customDomain'])
    // The help center domain tab needs help center access too.
    expect(linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN]).customDomain).toBeUndefined()
  })

  it('on Cloud, lands Custom domain on the custom domains card of the Domains page', () => {
    const links = linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN], {
      cloudEnabled: true,
      helpCenterOn: false,
    })
    expect(links.customDomain).toEqual({
      to: '/admin/settings/domains',
      hash: CUSTOM_DOMAINS_ANCHOR,
    })
  })

  it('does not depend on Support being on: email and sign-in stay open', () => {
    const links = linksFor(ALL, { helpCenterOn: false })
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
      helpCenterDomain: null,
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
      helpCenterDomain: { domain: 'help.acme.com', verified: false },
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

    expect(rowOf('acme.com')).toHaveTextContent('Ownership verified')
    expect(rowOf('acme.co.uk')).toHaveTextContent('Pending')
    expect(rowOf('example.org')).toHaveTextContent('Needs attention')

    const pendingSignIn = rowOf('example.net')
    expect(pendingSignIn).toHaveTextContent('Sign-in')
    expect(pendingSignIn).toHaveTextContent('Pending')
    expect(pendingSignIn).toHaveAttribute('href', '/admin/settings/domains/example.net')
    expect(rowOf('eu.acme.com')).toHaveTextContent('Already verified. Click Verify to use it.')
    expect(rowOf('example.io')).toHaveTextContent('Verified by this workspace')
    expect(rowOf('example.io')).not.toHaveTextContent('Pending')

    const help = rowOf('help.acme.com')
    expect(help).toHaveTextContent('Custom domain')
    expect(help).toHaveTextContent('Pending')
    expect(help).toHaveAttribute('href', '/admin/settings/domains/help.acme.com')
  })

  it('opens the domain, not one of its uses, when a domain has more than one', () => {
    const rows = domainRows({
      now: NOW,
      sending: [sending({})],
      signIn: [{ id: 'domain_a', name: 'ACME.com', verified: false, provenBy: null }],
      helpCenterDomain: null,
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
      helpCenterDomain: null,
    })
    render(<DomainList rows={rows} links={linksFor([PERMISSIONS.AUTH_MANAGE])} />)
    expect(rowOf('acme.com')).toHaveAttribute('href', '/admin/settings/domains/acme.com')
  })

  it('renders a row without a link for a viewer who cannot open its page', () => {
    const rows = domainRows({
      now: NOW,
      sending: [],
      signIn: [],
      helpCenterDomain: { domain: 'help.acme.com', verified: true },
    })
    render(<DomainList rows={rows} links={linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN])} />)
    const row = rowOf('help.acme.com')
    expect(row.tagName).not.toBe('A')
    expect(row.querySelector('[data-slot="settings-list-chevron"]')).toBeNull()
    expect(row).not.toHaveTextContent('Pending')
  })

  it('lists a domain added by name with no use, pending until verified, linked to its page', () => {
    const rows = domainRows({
      now: NOW,
      sending: [sending({})],
      signIn: [],
      helpCenterDomain: null,
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
})
