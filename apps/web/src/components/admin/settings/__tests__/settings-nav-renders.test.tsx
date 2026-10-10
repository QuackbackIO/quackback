// @vitest-environment happy-dom
/**
 * The settings nav stays mounted while the admin moves between settings
 * pages. A navigation changes which row is active, so only the row that
 * stops being active and the one that becomes active may render again, not
 * every row in the nav, and not the nav around them. A module is one row that
 * stays highlighted on all of its pages. Each navigation also
 * hands the tree a new route context object whose parts are unchanged.
 */
import { forwardRef, type ComponentType } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

// Each row's icon, wrapped to count the renders of the row contents it sits
// in, and the Link, wrapped to count the renders of the row around it (not
// the Link's own renders when its active state moves).
const { iconRenders, rowRenders, navRenders } = vi.hoisted(() => ({
  iconRenders: {} as Record<string, number>,
  rowRenders: [] as string[],
  navRenders: { count: 0 },
}))
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  const Link = actual.Link as unknown as ComponentType<{ to: string }>
  return {
    ...actual,
    Link: forwardRef<HTMLAnchorElement, { to: string }>(function CountedLink(props, ref) {
      rowRenders.push(props.to)
      return <Link {...props} {...{ ref }} />
    }),
  }
})
vi.mock('@heroicons/react/24/solid', async (importOriginal) => {
  const actual = await importOriginal<Record<string, ComponentType<object>>>()
  const counted = (name: string) => {
    const Icon = actual[name]!
    return (props: object) => {
      iconRenders[name] = (iconRenders[name] ?? 0) + 1
      return <Icon {...props} />
    }
  }
  return {
    ...actual,
    // General, Members & Teams, Notifications, Developers, and the Feedback module
    Cog6ToothIcon: counted('Cog6ToothIcon'),
    UsersIcon: counted('UsersIcon'),
    BellIcon: counted('BellIcon'),
    CommandLineIcon: counted('CommandLineIcon'),
    ChatBubbleLeftIcon: counted('ChatBubbleLeftIcon'),
  }
})

// Only the provider that builds the nav asks for the cloud flag, so this counts
// the renders of the nav around the rows.
vi.mock('@/lib/client/hooks/use-root-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/hooks/use-root-context')>()),
  useCloudEnabled: () => {
    navRenders.count++
    return false
  },
}))

import { SYSTEM_ROLE_PERMISSIONS } from '@/lib/shared/permissions'

const { SettingsNav, SettingsNavProvider } = await import('../settings-nav')

afterEach(cleanup)

// The root and admin beforeLoads keep one answer between navigations (their
// route-context memos), so the parts are the same objects each time while the
// route context around them is new.
const rootAnswer = {
  settings: { featureFlags: { feedback: true, changelog: true, supportInbox: true } },
  billingEnabled: false,
  cloudEnabled: false,
}
const adminAnswer = {
  // An admin's: every page the nav lists is one it may open.
  permissions: [...SYSTEM_ROLE_PERMISSIONS.owner],
}

async function mount(initial: string) {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => rootAnswer,
    component: () => <Outlet />,
  })
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    beforeLoad: () => ({ ...adminAnswer }),
    component: () => (
      <SettingsNavProvider>
        <SettingsNav />
        <Outlet />
      </SettingsNavProvider>
    ),
  })
  const pages = ['general', 'members', 'boards', 'boards/feature-requests', 'tags', 'channels'].map(
    (page) =>
      createRoute({
        getParentRoute: () => adminRoute,
        path: `/settings/${page}`,
        validateSearch: (search: Record<string, unknown>) => search as { tab?: string },
        component: () => <p>{page.split('/').pop()} page</p>,
      })
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([adminRoute.addChildren(pages)]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    context: {},
  })
  const view = render(<RouterProvider router={router} />)
  await screen.findByText(`${initial.split('/').pop()} page`)
  for (const key of Object.keys(iconRenders)) iconRenders[key] = 0
  rowRenders.length = 0
  navRenders.count = 0
  return { router, container: view.container }
}

const activeHrefs = (container: HTMLElement) =>
  [...container.querySelectorAll('a[data-active]')].map((a) => a.getAttribute('href'))

describe('SettingsNav', () => {
  it('moves the highlight without rendering the rows', async () => {
    const { router, container } = await mount('/admin/settings/general')
    expect(container.querySelectorAll('a').length).toBeGreaterThan(8)
    expect(activeHrefs(container)).toEqual(['/admin/settings/general'])

    await act(() => router.navigate({ to: '/admin/settings/members' }))
    await screen.findByText('members page')

    expect(activeHrefs(container)).toEqual(['/admin/settings/members'])
    // Row contents look the same active or not, so no icon renders again.
    const moved = {
      Cog6ToothIcon: 0,
      UsersIcon: 0,
      BellIcon: 0,
      CommandLineIcon: 0,
      ChatBubbleLeftIcon: 0,
    }
    expect(iconRenders).toEqual(moved)
    // The two Links moved their own state; no row around them rendered.
    expect(rowRenders).toEqual([])
    expect(navRenders.count).toBe(0)

    // A search-only navigation moves nothing.
    await act(() => router.navigate({ to: '/admin/settings/members', search: { tab: 'roles' } }))
    expect(activeHrefs(container)).toEqual(['/admin/settings/members'])
    expect(iconRenders).toEqual(moved)
    expect(rowRenders).toEqual([])
  })

  it('shows each module as one row that opens its first page', async () => {
    const { container } = await mount('/admin/settings/general')
    const row = screen.getByRole('link', { name: 'Feedback & Roadmaps' })
    expect(row.getAttribute('href')).toBe('/admin/settings/boards')
    expect(screen.getByRole('link', { name: 'Support' }).getAttribute('href')).toBe(
      '/admin/settings/channels'
    )
    // A module's pages are tabs on the page, not rows in the nav.
    for (const to of ['statuses', 'tags', 'moderation', 'macros']) {
      expect(container.querySelector(`a[href="/admin/settings/${to}"]`)).toBeNull()
    }
    expect(container.querySelector('button')).toBeNull()
  })

  it('highlights the module row on each of its pages and their child pages', async () => {
    const { router, container } = await mount('/admin/settings/tags')
    expect(activeHrefs(container)).toEqual(['/admin/settings/boards'])
    const row = screen.getByRole('link', { name: 'Feedback & Roadmaps' })
    expect(row.getAttribute('aria-current')).toBe('page')

    await act(() => router.navigate({ to: '/admin/settings/boards' }))
    await screen.findByText('boards page')
    expect(activeHrefs(container)).toEqual(['/admin/settings/boards'])

    await act(() =>
      router.navigate({
        to: '/admin/settings/boards/$slug',
        params: { slug: 'feature-requests' },
      })
    )
    await screen.findByText('feature-requests page')
    expect(activeHrefs(container)).toEqual(['/admin/settings/boards'])
    // Staying in the module moves nothing.
    expect(rowRenders).toEqual([])
    expect(navRenders.count).toBe(0)
  })

  it('moves the highlight into a module rendering only its row, and not its contents', async () => {
    const { router, container } = await mount('/admin/settings/general')
    await act(() => router.navigate({ to: '/admin/settings/tags' }))
    await screen.findByText('tags page')
    expect(activeHrefs(container)).toEqual(['/admin/settings/boards'])
    expect(rowRenders).toEqual(['/admin/settings/boards'])
    expect(iconRenders.ChatBubbleLeftIcon).toBe(0)
    expect(navRenders.count).toBe(0)
  })

  it('marks the active row with the muted fill, not the primary tint', async () => {
    const { container } = await mount('/admin/settings/boards')
    const active = container.querySelector('a[data-active]')!
    expect(active.className).toContain('bg-muted')
    expect(active.className).not.toContain('bg-primary')
  })
})
