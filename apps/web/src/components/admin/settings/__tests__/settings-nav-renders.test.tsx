// @vitest-environment happy-dom
/**
 * The settings nav stays mounted while the admin moves between settings
 * pages. A navigation changes which row is active, so only the row that
 * stops being active and the one that becomes active may render again, not
 * every row in the nav, and not the nav around them. Each navigation also
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

// Only the nav itself asks for the theme, so this counts the nav's renders.
vi.mock('@/lib/client/hooks/use-root-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/hooks/use-root-context')>()),
  useRefinedTheme: () => {
    navRenders.count++
    return false
  },
}))

const { SettingsNav } = await import('../settings-nav')

afterEach(cleanup)

// The root and admin beforeLoads keep one answer between navigations (their
// route-context memos), so the parts are the same objects each time while the
// route context around them is new.
const rootAnswer = {
  settings: { featureFlags: { feedback: true, changelog: true } },
  billingEnabled: false,
  cloudEnabled: false,
}
const adminAnswer = {
  // An admin's: every page the nav lists is one it may open.
  permissions: [
    'settings.manage',
    'settings.branding',
    'member.view',
    'auth.manage',
    'api_key.manage',
    'integration.view',
    'user_attribute.view',
    'company.view',
  ],
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
      <>
        <SettingsNav />
        <Outlet />
      </>
    ),
  })
  const pages = ['general', 'members', 'boards', 'tags'].map((page) =>
    createRoute({
      getParentRoute: () => adminRoute,
      path: `/settings/${page}`,
      validateSearch: (search: Record<string, unknown>) => search as { tab?: string },
      component: () => <p>{page} page</p>,
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
  it('re-renders only the rows whose active state a navigation changes', async () => {
    const { router, container } = await mount('/admin/settings/general')
    expect(container.querySelectorAll('a').length).toBeGreaterThan(8)
    expect(activeHrefs(container)).toEqual(['/admin/settings/general'])

    await act(() => router.navigate({ to: '/admin/settings/members' }))
    await screen.findByText('members page')

    expect(activeHrefs(container)).toEqual(['/admin/settings/members'])
    const moved = {
      Cog6ToothIcon: 1,
      UsersIcon: 1,
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

  it('keeps a module row active across its pages and renders it only on entering and leaving', async () => {
    const { router, container } = await mount('/admin/settings/general')

    await act(() => router.navigate({ to: '/admin/settings/boards' }))
    await screen.findByText('boards page')
    expect(activeHrefs(container)).toEqual(['/admin/settings/feedback'])
    expect(iconRenders).toMatchObject({ Cog6ToothIcon: 1, ChatBubbleLeftIcon: 1, UsersIcon: 0 })
    // Only the module row, which follows the location itself, rendered.
    expect(rowRenders).toEqual(['/admin/settings/feedback'])

    await act(() => router.navigate({ to: '/admin/settings/tags' }))
    await screen.findByText('tags page')
    expect(activeHrefs(container)).toEqual(['/admin/settings/feedback'])
    expect(iconRenders.ChatBubbleLeftIcon).toBe(1)
    expect(rowRenders).toEqual(['/admin/settings/feedback'])
    expect(navRenders.count).toBe(0)
  })
})
