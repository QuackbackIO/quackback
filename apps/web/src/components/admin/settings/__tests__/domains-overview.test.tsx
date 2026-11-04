// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string
    search?: Record<string, string>
    children: ReactNode
  }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...rest}>
      {children}
    </a>
  ),
}))

const { EmailSendingSection, HelpCenterAddressSection, NoDomains, SignInSection } =
  await import('../domains-overview')

const NOW = new Date('2026-11-03T12:00:00.000Z')

const sending = (over: Partial<Parameters<typeof EmailSendingSection>[0]['domains'][0]>) => ({
  id: 'sending_domain_1',
  domain: 'acme.com',
  status: 'verified',
  verifiedAt: '2026-11-01T00:00:00.000Z',
  autoCheckUntil: null,
  localParts: [],
  ownershipProven: false,
  ...over,
})

const rowOf = (text: string) => screen.getByText(text).closest('[data-slot="settings-list-row"]')!

describe('Email sending section', () => {
  it('lists each domain with its addresses, proof and link to the Email page', () => {
    render(
      <EmailSendingSection
        now={NOW}
        canOpen
        domains={[
          sending({ localParts: ['billing@', 'help@'], ownershipProven: true }),
          sending({
            id: 'sending_domain_2',
            domain: 'acme.co.uk',
            status: 'pending',
            verifiedAt: null,
            autoCheckUntil: '2026-11-05T00:00:00.000Z',
            localParts: ['updates@'],
          }),
          sending({ id: 'sending_domain_3', domain: 'example.org', status: 'failed' }),
        ]}
      />
    )

    const live = rowOf('acme.com')
    expect(live).toHaveTextContent('billing@, help@ · Ownership verified')
    expect(live).not.toHaveTextContent('Pending')
    expect(live).not.toHaveTextContent('Needs attention')
    expect(live).toHaveAttribute('href', '/admin/settings/channels/email')

    const pending = rowOf('acme.co.uk')
    expect(pending).toHaveTextContent('updates@')
    expect(pending).not.toHaveTextContent('Ownership verified')
    expect(pending).toHaveTextContent('Pending')

    expect(rowOf('example.org')).toHaveTextContent('Needs attention')
  })
})

describe('Sign-in section', () => {
  it('says how each domain was verified and badges the pending one', () => {
    render(
      <SignInSection
        canOpen
        domains={[
          { id: 'domain_a', name: 'acme.com', verified: true, provenBy: 'email-sending' },
          { id: 'domain_b', name: 'example.org', verified: true, provenBy: null },
          { id: 'domain_c', name: 'example.net', verified: false, provenBy: null },
          { id: 'domain_d', name: 'eu.acme.com', verified: false, provenBy: 'email-sending' },
          { id: 'domain_e', name: 'example.io', verified: true, provenBy: 'workspace' },
        ]}
      />
    )

    expect(rowOf('acme.com')).toHaveTextContent('Verified through email sending')
    expect(rowOf('example.org')).not.toHaveTextContent('Verified')
    expect(rowOf('example.org')).not.toHaveTextContent('Pending')
    const pending = rowOf('example.net')
    expect(pending).toHaveTextContent('Pending')
    expect(pending).not.toHaveTextContent('Verified')
    expect(pending).toHaveAttribute('href', '/admin/settings/security/authentication')
    const ready = rowOf('eu.acme.com')
    expect(ready).toHaveTextContent('Already verified. Click Verify to use it.')
    expect(ready).toHaveTextContent('Pending')
    expect(rowOf('example.io')).toHaveTextContent('Verified by this workspace')
  })
})

describe('Help center custom domain', () => {
  it('links to the help center Domains tab for a viewer who can open it', () => {
    render(
      <HelpCenterAddressSection domain={{ domain: 'help.acme.com', verified: false }} canOpen />
    )
    const row = rowOf('help.acme.com')
    expect(row).toHaveAttribute('href', '/admin/settings/help-center?tab=domains-languages')
    expect(row).toHaveTextContent('Pending')
  })

  it('renders without a link or chevron for a viewer who cannot', () => {
    render(
      <HelpCenterAddressSection
        domain={{ domain: 'help.acme.com', verified: true }}
        canOpen={false}
      />
    )
    const row = rowOf('help.acme.com')
    expect(row.tagName).not.toBe('A')
    expect(row.querySelector('[data-slot="settings-list-chevron"]')).toBeNull()
    expect(row).not.toHaveTextContent('Pending')
  })
})

describe('empty state', () => {
  it('is one quiet line', () => {
    render(<NoDomains />)
    expect(
      screen.getByText('No domains yet. Add one from Email, Help center or Security.')
    ).toBeInTheDocument()
  })
})
