// @vitest-environment happy-dom
/**
 * Home's hero draws one main action under its headline: the help search, a
 * call to action that opens the composer in place or goes to the roadmap,
 * with a quiet second one, or nothing. Away from the hero the composer is a
 * block on the grid. A choice whose page is off draws as None.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { createContext, createElement, forwardRef, type ReactNode } from 'react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicBoards: async () => [],
  fetchBoardCapabilitiesFn: async () => ({ permissions: {}, boards: [] }),
  fetchPublicPosts: vi.fn(),
  fetchPublicStatuses: vi.fn(),
  fetchPublicTags: vi.fn(),
  fetchAvatars: vi.fn(),
  fetchPublicRoadmaps: vi.fn(),
  fetchPublicRoadmapPosts: vi.fn(),
  fetchPortalData: vi.fn(),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/components/help-center/help-center-search', () => ({
  HelpCenterHeroSearch: ({ askAiEnabled, size }: { askAiEnabled?: boolean; size?: string }) => (
    <div data-testid="help-search" data-ask-ai={String(!!askAiEnabled)} data-size={size} />
  ),
}))

// happy-dom rejects a cancelled animation's promise, which motion leaves
// unhandled; the composer's open and close need no real animation here.
vi.mock('framer-motion', () => {
  const MOTION_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout'])
  const make = (tag: string) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      const dom: Record<string, unknown> = { ref }
      for (const [key, value] of Object.entries(rest)) if (!MOTION_PROPS.has(key)) dom[key] = value
      return createElement(tag, dom, children as ReactNode)
    })
  // One component per tag, so a re-render keeps the same element.
  const made = new Map<string, ReturnType<typeof make>>()
  const proxy = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (typeof prop !== 'string') return undefined
        if (!made.has(prop)) made.set(prop, make(prop))
        return made.get(prop)
      },
    }
  )
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    MotionConfigContext: createContext({}),
    motion: proxy,
  }
})

import { PortalHome } from '../portal-home'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const HEADLINE = { title: { en: 'What should we build next?' }, subtitle: {} }
const BLOCKS = [{ type: 'composer', id: 'composer01', grid: { x: 0, y: 0, w: 12, h: 1 } }]

async function mountHome(
  home: Record<string, unknown>,
  gates = GATES,
  flags: Record<string, boolean> = { helpCenter: true }
) {
  const root = createRootRouteWithContext<object>()({
    beforeLoad: () => ({
      settings: {
        featureFlags: flags,
        portalDesign: {
          engine: 'v2',
          attributes: {},
          home: { headline: HEADLINE, blocks: BLOCKS, ...home },
          feedback: { headline: null },
        } as never,
      },
    }),
  })
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <PortalHome gates={gates} />,
  })
  const others = ['/feedback', '/roadmap', '/hc', '/support'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null })
  )
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  })
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" onError={() => {}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
  await waitFor(() => expect(view.container.querySelector('[data-qb-section=home]')).not.toBeNull())
  return view.container
}

const band = (page: HTMLElement) => page.querySelector('[data-qb-part=band]')!
const grid = (page: HTMLElement) => page.querySelector('[data-qb-section=home]')!

afterEach(cleanup)

describe('Search as the main action', () => {
  it('puts the help search in the hero, with Ask AI where it is on, the composer on the grid', async () => {
    const page = await mountHome({ mainAction: 'search' })
    const search = band(page).querySelector('[data-testid=help-search]')!
    expect(search.getAttribute('data-ask-ai')).toBe('true')
    expect(search.getAttribute('data-size')).toBe('hero')
    expect(band(page).querySelector('[data-qb-part=composer]')).toBeNull()
    expect(grid(page).querySelector('[data-qb-part=composer]')).not.toBeNull()
  })

  it('draws as None without the help centre', async () => {
    const page = await mountHome({ mainAction: 'search' }, { ...GATES, help: false })
    expect(band(page).querySelector('[data-testid=help-search]')).toBeNull()
    expect(band(page).querySelector('[data-qb-band-action]')).toBeNull()
  })
})

describe('Button as the main action', () => {
  it('opens the composer in place from its call to action, and gives it back on Cancel', async () => {
    const page = await mountHome({ mainAction: 'button' })
    const action = band(page).querySelector<HTMLButtonElement>('button[data-qb-action]')!
    expect(action.textContent).toBe('Write a post')
    expect(action.querySelector('[data-qb-words="home.button"]')).not.toBeNull()
    expect(band(page).querySelector('[data-qb-part=composer]')).toBeNull()
    await act(async () => fireEvent.click(action))
    const composer = band(page).querySelector('[data-qb-part=composer]')!
    expect(composer.getAttribute('data-state')).toBe('open')
    const cancel = [...composer.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!
    await act(async () => fireEvent.click(cancel))
    await waitFor(() => expect(band(page).querySelector('button[data-qb-action]')).not.toBeNull())
  })

  it('goes to the roadmap, with a quiet second button that opens the composer', async () => {
    const page = await mountHome({
      mainAction: 'button',
      button: { to: 'roadmap', second: true },
    })
    const action = band(page).querySelector<HTMLAnchorElement>('a[data-qb-action]')!
    expect(action.getAttribute('href')).toBe('/roadmap')
    expect(action.textContent).toBe("See what's coming")
    const second = band(page).querySelector<HTMLButtonElement>('[data-qb-band-action] button')!
    expect(second.hasAttribute('data-qb-action')).toBe(false)
    expect(second.querySelector('[data-qb-words="home.secondButton"]')!.textContent).toBe(
      'Write a post'
    )
    await act(async () => fireEvent.click(second))
    expect(band(page).querySelector('[data-qb-part=composer]')).not.toBeNull()
  })

  it('says the design’s own words, and leaves the second out unless asked', async () => {
    const page = await mountHome({
      mainAction: 'button',
      button: { label: { en: 'Tell us' }, secondLabel: { en: 'Roadmap' } },
    })
    const buttons = band(page).querySelectorAll('[data-qb-band-action] :is(a,button)')
    expect([...buttons].map((b) => b.textContent)).toEqual(['Tell us'])
  })

  it.each([
    ['help', '/hc', 'Visit the help center'],
    ['support', '/support', 'Start a conversation'],
  ])('goes to %s', async (to, href, words) => {
    const page = await mountHome({ mainAction: 'button', button: { to } })
    const action = band(page).querySelector<HTMLAnchorElement>('a[data-qb-action]')!
    expect(action.getAttribute('href')).toBe(href)
    expect(action.textContent).toBe(words)
  })

  it('goes to the composer while the roadmap is off', async () => {
    const page = await mountHome(
      { mainAction: 'button', button: { to: 'roadmap' } },
      { ...GATES, roadmap: false }
    )
    expect(band(page).querySelector('a[data-qb-action]')).toBeNull()
    expect(band(page).querySelector('button[data-qb-action]')!.textContent).toBe('Write a post')
  })
})

describe('None as the main action', () => {
  it('leaves the headline alone in the hero, and the composer on the grid', async () => {
    const page = await mountHome({ mainAction: 'none' })
    expect(band(page).querySelector('[data-qb-band-composer]')).toBeNull()
    expect(band(page).querySelector('[data-qb-band-action]')).toBeNull()
    expect(grid(page).querySelector('[data-qb-part=composer]')).not.toBeNull()
  })
})
