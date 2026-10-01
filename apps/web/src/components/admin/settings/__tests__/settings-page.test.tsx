// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

const { SettingsPage } = await import('../settings-page')

afterEach(cleanup)

function renderPage(node: ReactNode) {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </IntlProvider>
  )
}

describe('SettingsPage', () => {
  it('takes the title from the registry for a registered page', () => {
    renderPage(<SettingsPage page="/admin/settings/office-hours">body</SettingsPage>)
    expect(screen.getByRole('heading', { level: 1, name: 'Office hours' })).toBeInTheDocument()
  })

  it('resolves automation pages through their message descriptor', () => {
    renderPage(<SettingsPage page="/admin/settings/connectors" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Connectors' })).toBeInTheDocument()
  })

  it('uses an explicit title for a dynamic page', () => {
    renderPage(<SettingsPage title="Feature requests" description="One board" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Feature requests' })).toBeInTheDocument()
    expect(screen.getByText('One board')).toBeInTheDocument()
  })

  it('passes a logo through to the header', () => {
    renderPage(<SettingsPage title="Slack" logo={<svg data-testid="logo" />} />)
    expect(screen.getByTestId('logo')).toBeInTheDocument()
  })

  it('rejects giving both or neither of page and title', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    // @ts-expect-error both given
    expect(() => renderPage(<SettingsPage page="/admin/settings/tags" title="Tags" />)).toThrow()
    // @ts-expect-error neither given
    expect(() => renderPage(<SettingsPage />)).toThrow()
    quiet.mockRestore()
  })

  it('is form width by default and wide on request', () => {
    const { container, rerender } = renderPage(<SettingsPage page="/admin/settings/tags" />)
    const root = () => container.querySelector('[data-settings-page-body]') as HTMLElement
    expect(root().className).toContain('max-w-3xl')
    expect(root().className).not.toContain('max-w-5xl')
    rerender(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={new QueryClient()}>
          <SettingsPage page="/admin/settings/tags" width="wide" />
        </QueryClientProvider>
      </IntlProvider>
    )
    expect(root().className).toContain('max-w-5xl')
    expect(root().className).not.toContain('max-w-3xl')
  })

  it('shows a mobile-only back link to the settings index when there are no crumbs', () => {
    renderPage(<SettingsPage page="/admin/settings/tags" />)
    const link = screen.getByRole('link', { name: 'Settings' })
    expect(link.getAttribute('href')).toBe('/admin/settings')
    expect(link.parentElement?.className).toContain('lg:hidden')
  })

  it('passes crumbs to the header and drops the back link when a crumb links up', () => {
    renderPage(
      <SettingsPage
        page="/admin/settings/channels/email"
        crumbs={[{ label: 'Support' }, { label: 'Channels', to: '/admin/settings/channels' }]}
      />
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Channels' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })

  it('keeps the mobile back link when no crumb has a link', () => {
    renderPage(<SettingsPage page="/admin/settings/macros" crumbs={[{ label: 'Support' }]} />)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).queryByRole('link')).toBeNull()
    const link = screen.getByRole('link', { name: 'Settings' })
    expect(link.getAttribute('href')).toBe('/admin/settings')
    expect(link.parentElement?.className).toContain('lg:hidden')
  })

  it('omits the back link on an index page that is itself the target', () => {
    renderPage(<SettingsPage title="Settings" backLink={false} />)
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })

  it('gives an AI & Automation page the settings back link', () => {
    renderPage(<SettingsPage page="/admin/settings/skills" />)
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '/admin/settings'
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Skills' })).toBeInTheDocument()
  })

  it('renders actions, the save status slot and children', () => {
    renderPage(
      <SettingsPage page="/admin/settings/tags" actions={<button>New tag</button>}>
        <p>content</p>
      </SettingsPage>
    )
    expect(screen.getByRole('button', { name: 'New tag' })).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})
