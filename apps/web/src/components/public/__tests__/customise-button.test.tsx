// @vitest-environment happy-dom
/** The Customise button shows only to people who may change the branding. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { PortalPermissionsProvider } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'

const route = vi.hoisted(() => ({
  location: { pathname: '/feedback', search: {} as Record<string, unknown> },
  settings: { portalDesign: { engine: 'v2' } } as {
    portalDesign?: { engine: string }
    portalDesignSwitchable?: true
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: route.location }),
  useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
    select({ settings: route.settings }),
}))

const draft = vi.hoisted(() => ({ waiting: false }))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignDraftWaitingFn: async () => ({ waiting: draft.waiting }),
}))

const { CustomiseButton } = await import('../customise-button')

afterEach(() => {
  cleanup()
  route.location = { pathname: '/feedback', search: {} }
  route.settings = { portalDesign: { engine: 'v2' } }
})

function show(permissions: string[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en">
        <PortalPermissionsProvider permissionKeys={permissions}>
          <CustomiseButton />
        </PortalPermissionsProvider>
      </IntlProvider>
    </QueryClientProvider>
  )
  return screen.queryByRole('link', { name: 'Customise' })
}

describe('CustomiseButton', () => {
  it('opens the designer on the page someone is on', () => {
    const link = show([PERMISSIONS.SETTINGS_BRANDING])
    expect(link?.getAttribute('href')).toBe('/design?path=%2Ffeedback&from=portal')
    expect(link?.getAttribute('title')).toBeNull()
  })

  it('is never there for a visitor or a teammate who may not change the branding', () => {
    expect(show([])).toBeNull()
    cleanup()
    expect(show([PERMISSIONS.SETTINGS_MANAGE])).toBeNull()
  })

  it('is not there on the old engine by choice or with the Labs switch off', () => {
    // Settings send no design on legacy; only a portal kept there by its CSS says it can switch.
    route.settings = {}
    expect(show([PERMISSIONS.SETTINGS_BRANDING])).toBeNull()
  })

  it('on the old engine for its CSS, goes to the switch card and says why', () => {
    route.settings = { portalDesignSwitchable: true }
    const link = show([PERMISSIONS.SETTINGS_BRANDING])!
    expect(link.getAttribute('href')).toBe('/admin/settings/portal#design-switch')
    expect(link.getAttribute('title')).toBe('Switch to the new design to customise')
    cleanup()
    expect(show([PERMISSIONS.SETTINGS_MANAGE])).toBeNull()
  })

  it('is never there inside a preview', () => {
    route.location = { pathname: '/', search: { preview: true } }
    expect(show([PERMISSIONS.SETTINGS_BRANDING])).toBeNull()
    cleanup()
    route.settings = { portalDesignSwitchable: true }
    expect(show([PERMISSIONS.SETTINGS_BRANDING])).toBeNull()
  })

  it('says when a draft is waiting, and that it is opening once clicked', async () => {
    draft.waiting = true
    const link = show([PERMISSIONS.SETTINGS_BRANDING])!
    expect(await screen.findByText('A draft is waiting')).toBeTruthy()
    fireEvent.click(link)
    expect(link.textContent).toContain('Opening…')
    expect(link.getAttribute('aria-busy')).toBe('true')
    draft.waiting = false
  })
})
