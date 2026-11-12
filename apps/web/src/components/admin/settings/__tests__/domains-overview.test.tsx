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
    search,
    hash,
    children,
    ...rest
  }: {
    to: string
    search?: Record<string, string>
    hash?: string
    children: ReactNode
  }) => (
    <a
      href={`${to}${search ? `?${new URLSearchParams(search).toString()}` : ''}${hash ? `#${hash}` : ''}`}
      {...rest}
    >
      {children}
    </a>
  ),
}))

const { DomainList, DomainsEmptyState, domainRows, domainUseLinks, CUSTOM_DOMAINS_ANCHOR } =
  await import('../domains-overview')

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

describe('empty state', () => {
  it('offers each use with its own way to set it up', () => {
    render(<DomainsEmptyState links={linksFor(ALL)} />)

    const email = rowOf('Email sending')
    expect(email).toHaveTextContent('Send replies and announcements from your own address.')
    expect(within(email as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/settings/email'
    )

    const custom = rowOf('Custom domain')
    expect(custom).toHaveTextContent('Put your portal on feedback.yourcompany.com.')
    expect(within(custom as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/settings/help-center?tab=domains-languages'
    )

    const signIn = rowOf('Sign-in')
    expect(signIn).toHaveTextContent(
      'Let everyone with an address at your domain sign in with SSO.'
    )
    expect(within(signIn as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/settings/security/authentication?tab=sign-in'
    )
  })

  it('never says Security, and is no longer the dead-end line', () => {
    const { container } = render(<DomainsEmptyState links={linksFor(ALL)} />)
    expect(container).not.toHaveTextContent('Security')
    expect(container).not.toHaveTextContent('No domains yet')
  })

  it('shows only the uses the viewer may set up', () => {
    render(<DomainsEmptyState links={linksFor([PERMISSIONS.AUTH_MANAGE])} />)
    expect(screen.queryByText('Email sending')).toBeNull()
    expect(screen.queryByText('Custom domain')).toBeNull()
    expect(screen.getByText('Sign-in')).toBeInTheDocument()
  })

  it('gates each use on the permission of the page it opens', () => {
    expect(Object.keys(linksFor([EMAIL_SENDING_PERMISSION]))).toEqual(['email'])
    expect(Object.keys(linksFor([PERMISSIONS.AUTH_MANAGE]))).toEqual(['signIn'])
    expect(
      Object.keys(linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN, PERMISSIONS.HELP_CENTER_MANAGE]))
    ).toEqual(['customDomain'])
    // The help center domain tab needs help center access too.
    expect(linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN]).customDomain).toBeUndefined()
  })

  it('on Cloud, lands Custom domain on the custom domains card of this page', () => {
    const links = linksFor([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN], {
      cloudEnabled: true,
      helpCenterOn: false,
    })
    render(<DomainsEmptyState links={links} />)
    expect(within(rowOf('Custom domain') as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      `/admin/settings/domains#${CUSTOM_DOMAINS_ANCHOR}`
    )
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
    expect(row).toHaveAttribute('href', '/admin/settings/email')
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
    expect(pendingSignIn).toHaveAttribute(
      'href',
      '/admin/settings/security/authentication?tab=sign-in'
    )
    expect(rowOf('eu.acme.com')).toHaveTextContent('Already verified. Click Verify to use it.')
    expect(rowOf('example.io')).toHaveTextContent('Verified by this workspace')
    expect(rowOf('example.io')).not.toHaveTextContent('Pending')

    const help = rowOf('help.acme.com')
    expect(help).toHaveTextContent('Custom domain')
    expect(help).toHaveTextContent('Pending')
    expect(help).toHaveAttribute('href', '/admin/settings/help-center?tab=domains-languages')
  })

  it('opens the use that needs attention when a domain has more than one', () => {
    const rows = domainRows({
      now: NOW,
      sending: [sending({})],
      signIn: [{ id: 'domain_a', name: 'ACME.com', verified: false, provenBy: null }],
      helpCenterDomain: null,
    })
    render(<DomainList rows={rows} links={linksFor(ALL)} />)
    const row = rowOf('acme.com')
    expect(row).toHaveTextContent('Pending')
    expect(row).toHaveAttribute('href', '/admin/settings/security/authentication?tab=sign-in')
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
})
