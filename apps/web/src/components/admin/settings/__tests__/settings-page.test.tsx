// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import type { PermissionKey } from '@/lib/shared/permissions'

// The anchor a Link renders, with the attributes it passes through.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const { SettingsPage, SettingsNavContext } = await import('../settings-page')
const { buildNavSections, navSectionsFor } = await import('../settings-nav-sections')
const { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } = await import('@/lib/shared/permissions')

afterEach(cleanup)

function renderPage(node: ReactNode) {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </IntlProvider>
  )
}

/** Inside the settings layout, which hands every page the nav as this viewer sees it. */
function renderInSettings(
  node: ReactNode,
  {
    flags = { supportInbox: true },
    permissions = SYSTEM_ROLE_PERMISSIONS.owner,
  }: { flags?: Record<string, boolean>; permissions?: readonly PermissionKey[] } = {}
) {
  const sections = navSectionsFor(buildNavSections(flags), new Set(permissions))
  return renderPage(
    <SettingsNavContext.Provider value={sections}>{node}</SettingsNavContext.Provider>
  )
}

const tabLabels = (name: string) =>
  within(screen.getByRole('navigation', { name }))
    .getAllByRole('link')
    .map((link) => link.textContent)

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

  describe('on a module page', () => {
    it('is titled with the module and shows its pages as tabs, the page itself current', () => {
      renderInSettings(<SettingsPage page="/admin/settings/tags">body</SettingsPage>)
      expect(
        screen.getByRole('heading', { level: 1, name: 'Feedback & Roadmaps' })
      ).toBeInTheDocument()
      expect(tabLabels('Feedback & Roadmaps')).toEqual(['Boards', 'Statuses', 'Tags', 'Moderation'])
      const tabs = within(screen.getByRole('navigation', { name: 'Feedback & Roadmaps' }))
      expect(tabs.getByRole('link', { name: 'Tags' }).getAttribute('aria-current')).toBe('page')
      expect(tabs.getByRole('link', { name: 'Boards' }).getAttribute('href')).toBe(
        '/admin/settings/boards'
      )
      expect(tabs.getByRole('link', { name: 'Boards' }).hasAttribute('aria-current')).toBe(false)
      // The module title is the top of the page, so there is no breadcrumb above it.
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    })

    it('marks the tabs with the tab slots the admin theme draws, the current one active', () => {
      renderInSettings(<SettingsPage page="/admin/settings/tags" />)
      const bar = screen.getByRole('navigation', { name: 'Feedback & Roadmaps' })
      expect(bar.dataset.slot).toBe('tabs-list')
      expect(bar.dataset.variant).toBe('line')
      const tabs = within(bar).getAllByRole('link')
      for (const tab of tabs) {
        expect(tab.dataset.slot).toBe('tabs-trigger')
        expect(tab.dataset.variant).toBe('line')
      }
      expect(
        tabs.filter((tab) => tab.hasAttribute('data-active')).map((tab) => tab.textContent)
      ).toEqual(['Tags'])
    })

    it('keeps the actions in the header and the mobile back link to the settings index', () => {
      renderInSettings(
        <SettingsPage page="/admin/settings/tags" actions={<button>New tag</button>} />
      )
      expect(screen.getByRole('button', { name: 'New tag' })).toBeInTheDocument()
      const back = screen.getByRole('link', { name: 'Settings' })
      expect(back.getAttribute('href')).toBe('/admin/settings')
      expect(back.parentElement?.className).toContain('lg:hidden')
    })

    it("puts the page's description under the tabs, not under the module title", () => {
      renderInSettings(
        <SettingsPage page="/admin/settings/sla" description="Response and resolution targets." />
      )
      const header = document.querySelector('[data-page-header]')!
      expect(header.textContent).not.toContain('Response and resolution targets.')
      const tabs = screen.getByRole('navigation', { name: 'Support' })
      const description = screen.getByText('Response and resolution targets.')
      expect(
        tabs.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('lists only the pages of the module the viewer can open', () => {
      renderInSettings(<SettingsPage page="/admin/settings/office-hours" />, {
        permissions: [PERMISSIONS.OFFICE_HOURS_MANAGE, PERMISSIONS.SLA_MANAGE],
      })
      expect(tabLabels('Support')).toEqual(['Office hours', 'SLA policies'])
    })
  })

  it('shows no tabs on a page that is not one of a module, nor on a child page', () => {
    renderInSettings(<SettingsPage page="/admin/settings/general" />)
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument()
    cleanup()

    renderInSettings(
      <SettingsPage
        page="/admin/settings/channels/email"
        crumbs={[
          { label: 'Support', to: '/admin/settings/support' },
          { label: 'Channels', to: '/admin/settings/channels' },
        ]}
      />
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Email' })).toBeInTheDocument()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Support' }).getAttribute('href')).toBe(
      '/admin/settings/support'
    )
    expect(screen.queryByRole('navigation', { name: 'Support' })).toBeNull()
  })
})
