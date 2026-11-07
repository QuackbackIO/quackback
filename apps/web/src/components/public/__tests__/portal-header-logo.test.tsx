// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/shared/types/settings'

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: vi.fn() }) }))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({ getMyConversationsFn: vi.fn() }))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/components/notifications', () => ({ NotificationBell: () => null }))
vi.mock('@/components/shared/user-stats', () => ({ UserStatsBar: () => null }))

const { PortalHeader } = await import('../portal-header')
const { PreviewLogoContext } = await import('../preview-draft-context')

afterEach(cleanup)

type Logo = {
  display: 'mark_and_name' | 'mark' | 'wordmark' | 'name'
  name: string | null
  wordmark: { light: string | null; dark: string | null }
  mark?: { light: string | null; dark: string | null }
}

const design = (logo: Partial<Logo>) => ({
  engine: 'v2',
  attributes: {},
  logo: { display: 'mark_and_name', name: null, wordmark: { light: null, dark: null }, ...logo },
})

async function mount(portalDesign?: unknown, preview?: Logo) {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => ({
      session: null,
      settings: { featureFlags: DEFAULT_FEATURE_FLAGS, portalDesign: portalDesign as never },
      registeredAuthProviders: [],
    }),
    component: () => (
      <PreviewLogoContext.Provider value={preview}>
        <PortalHeader orgName="Harbor" userRole="user" />
      </PreviewLogoContext.Provider>
    ),
  })
  const home = createRoute({ getParentRoute: () => rootRoute, path: '/' })
  const router = createRouter({
    routeTree: rootRoute.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  })
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
  await waitFor(() => expect(view.container.querySelector('[data-qb-part=logo]')).not.toBeNull())
  return view.container.querySelector('[data-qb-part=logo]')!
}

describe('the header logo a design chooses', () => {
  it('shows the mark and the workspace name by default, and on the legacy theme', async () => {
    const logo = await mount()
    expect(logo.textContent).toBe('HHarbor')
  })

  it('shows the wordmark file, with its dark file in dark mode', async () => {
    const logo = await mount(
      design({
        display: 'wordmark',
        wordmark: { light: '/api/storage/logos/ink.svg', dark: '/api/storage/logos/paper.svg' },
      })
    )
    const files = [...logo.querySelectorAll('img')]
    expect(files.map((img) => [img.getAttribute('src'), img.getAttribute('alt')])).toEqual([
      ['/api/storage/logos/ink.svg', 'Harbor'],
      ['/api/storage/logos/paper.svg', 'Harbor'],
    ])
    expect(files[0]!.className).toContain('dark:hidden')
    expect(files[1]!.className).toContain('dark:block')
    expect(logo.textContent).toBe('')
    // The link says whose portal it is, whatever the file shows.
    expect(logo.getAttribute('aria-label')).toBe('Harbor')
  })

  it('keeps the one wordmark file in dark mode when there is no dark file', async () => {
    const logo = await mount(
      design({ display: 'wordmark', wordmark: { light: '/api/storage/logos/ink.svg', dark: null } })
    )
    const files = [...logo.querySelectorAll('img')]
    expect(files).toHaveLength(1)
    expect(files[0]!.className).not.toContain('dark:hidden')
  })

  it('falls back to the mark and name while a wordmark has no file', async () => {
    const logo = await mount(design({ display: 'wordmark' }))
    expect(logo.getAttribute('data-qb-logo')).toBe('mark_and_name')
    expect(logo.textContent).toBe('HHarbor')
  })

  it('sets the name as a wordmark in the heading font, without the mark', async () => {
    const logo = await mount(design({ display: 'name', name: 'Harbor & Pine' }))
    const name = logo.querySelector('.portal-header__name')!
    expect(logo.textContent).toBe('Harbor & Pine')
    expect(name.className).toContain('[font-family:var(--qb-font-heading)]')
    expect(name.className).not.toContain('hidden')
  })

  it('shows the design’s own logo in place of the workspace’s, with its dark one in dark mode', async () => {
    const logo = await mount(
      design({
        display: 'mark',
        mark: { light: '/api/storage/logos/mark.svg', dark: '/api/storage/logos/mark-dark.svg' },
      })
    )
    const files = [...logo.querySelectorAll('img')]
    expect(files.map((img) => img.getAttribute('src'))).toEqual([
      '/api/storage/logos/mark.svg',
      '/api/storage/logos/mark-dark.svg',
    ])
    expect(files[0]!.className).toContain('dark:hidden')
    expect(files[1]!.className).toContain('dark:block')
  })

  it('shows the mark alone for mark', async () => {
    const logo = await mount(design({ display: 'mark' }))
    expect(logo.textContent).toBe('H')
  })

  it('follows the draft’s logo in the preview', async () => {
    const logo = await mount(design({ display: 'mark' }), {
      display: 'name',
      name: 'Draft name',
      wordmark: { light: null, dark: null },
    })
    expect(logo.textContent).toBe('Draft name')
  })

  it('shows the icon and the title, the title in the theme’s heading font', async () => {
    const logo = await mount(
      design({
        display: 'mark_and_name',
        name: 'Voltline',
        mark: { light: '/api/storage/logos/icon.png', dark: null },
      })
    )
    const name = logo.querySelector('.portal-header__name')!
    expect(name.textContent).toBe('Voltline')
    expect(name.className).toContain('[font-family:var(--qb-font-heading)]')
    expect(name.className).toContain('[font-weight:var(--qb-heading-weight)]')
    expect(name.querySelector('span')).toBeNull()
  })

  it('draws an image logo through the filter the design names where its ink would vanish, never on a tile', async () => {
    const icon = (
      await mount(
        design({
          display: 'mark_and_name',
          mark: { light: '/api/storage/logos/icon.png', dark: null },
        })
      )
    ).querySelector('img')!
    expect(icon.className).toContain('[filter:var(--qb-logo-filter,none)]')
    expect(icon.className).not.toContain('qb-logo-tile')
    cleanup()
    const full = (
      await mount(
        design({
          display: 'wordmark',
          wordmark: { light: '/api/storage/logos/full.png', dark: null },
        })
      )
    ).querySelector('img')!
    expect(full.className).toContain('[filter:var(--qb-logo-filter,none)]')
    // The filters it can name sit beside it.
    for (const id of ['qb-logo-reverse', 'qb-logo-lift', 'qb-logo-sink', 'qb-logo-ink'])
      expect(document.getElementById(id)?.tagName.toLowerCase()).toBe('filter')
  })
})
