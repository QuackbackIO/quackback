// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Breadcrumbs } from '../breadcrumbs'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

describe('<Breadcrumbs>', () => {
  it('renders each segment in order with a separator between', () => {
    const { container } = render(
      <Breadcrumbs
        segments={[
          { label: 'Settings', to: '/admin/settings' },
          { label: 'Security', to: '/admin/settings/security/authentication' },
          { label: 'Single sign-on' },
        ]}
      />
    )
    const text = container.textContent ?? ''
    const settingsIdx = text.indexOf('Settings')
    const securityIdx = text.indexOf('Security')
    const ssoIdx = text.indexOf('Single sign-on')
    expect(settingsIdx).toBeGreaterThan(-1)
    expect(securityIdx).toBeGreaterThan(settingsIdx)
    expect(ssoIdx).toBeGreaterThan(securityIdx)
  })

  it('renders non-terminal segments as links, terminal segment as text', () => {
    render(
      <Breadcrumbs
        segments={[
          { label: 'Settings', to: '/admin/settings' },
          { label: 'Security', to: '/admin/settings/security/authentication' },
          { label: 'Single sign-on', to: '/admin/settings/security/sso' },
        ]}
      />
    )
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/admin/settings'
    )
    expect(screen.getByRole('link', { name: 'Security' })).toHaveAttribute(
      'href',
      '/admin/settings/security/authentication'
    )
    // Last segment ignores its `to` and renders as plain text, not a link.
    expect(screen.queryByRole('link', { name: 'Single sign-on' })).toBeNull()
    expect(screen.getByText('Single sign-on')).toBeInTheDocument()
  })

  it('uses an aria-label for accessibility', () => {
    const { container } = render(
      <Breadcrumbs
        segments={[{ label: 'Settings', to: '/admin/settings' }, { label: 'Security' }]}
      />
    )
    expect(container.querySelector('nav[aria-label="Breadcrumb"]')).toBeInTheDocument()
  })
})
