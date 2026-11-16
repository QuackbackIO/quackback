// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children: ReactNode }) => (
    <a href={`${to}${hash ? `#${hash}` : ''}`} {...rest}>
      {children}
    </a>
  ),
}))

const { SectionDomainCard } = await import('../section-domain-card')

afterEach(cleanup)

const AT = '2026-11-01T00:00:00.000Z'

describe('a product page custom domain', () => {
  it("shows the section's own domain, read-only, with the way to change it on Settings > Domains", () => {
    render(
      <SectionDomainCard
        section="help"
        map={{ help: { hostname: 'help.acme.com', verifiedAt: AT } }}
        primaryHost="acme.com"
        canManage
      />
    )
    expect(screen.getByText('Custom domain')).toBeVisible()
    expect(screen.getByText('help.acme.com')).toBeVisible()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('Pending')).toBeNull()
    expect(screen.getByRole('link', { name: 'Custom domains' })).toHaveAttribute(
      'href',
      '/admin/settings/domains#custom-domains'
    )
  })

  it('shows the primary domain for a section without one of its own', () => {
    render(<SectionDomainCard section="status" map={{}} primaryHost="acme.com" canManage />)
    expect(screen.getByText('acme.com (primary domain)')).toBeVisible()
  })

  it('says when the domain is pending', () => {
    render(
      <SectionDomainCard
        section="status"
        map={{ status: { hostname: 'status.acme.com', verifiedAt: null } }}
        primaryHost="acme.com"
        canManage
      />
    )
    expect(screen.getByText('Pending')).toBeVisible()
  })

  it('says by when a domain that stopped answering has to be fixed', () => {
    render(
      <SectionDomainCard
        section="status"
        map={{ status: { hostname: 'status.acme.com', verifiedAt: AT, unconfirmedSince: AT } }}
        primaryHost="acme.com"
        canManage
      />
    )
    expect(screen.getByText('Needs attention')).toBeVisible()
    expect(screen.getByText('Not answering. Fix DNS by November 8, 2026.')).toBeVisible()
  })

  it('offers no link to a viewer who cannot manage custom domains', () => {
    render(
      <SectionDomainCard
        section="help"
        map={{ help: { hostname: 'help.acme.com', verifiedAt: AT } }}
        primaryHost="acme.com"
        canManage={false}
      />
    )
    expect(screen.getByText('help.acme.com')).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
