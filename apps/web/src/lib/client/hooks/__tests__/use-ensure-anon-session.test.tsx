// @vitest-environment happy-dom
/**
 * Every post card in a list calls useEnsureAnonSession. The root route hands
 * the tree a fresh context object on each navigation, so reading the whole
 * context rendered every card again for a navigation that changed nothing
 * they show. Only whether a session exists matters to the hook.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

const anonymousSignIn = vi.fn(async () => ({ error: null }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: () => anonymousSignIn() } },
}))

const { useEnsureAnonSession } = await import('../use-ensure-anon-session')

afterEach(() => {
  cleanup()
  anonymousSignIn.mockClear()
})

let cardRenders = 0
let ensure: () => Promise<boolean> = async () => false

function Card() {
  cardRenders++
  ensure = useEnsureAnonSession()
  return <p>card</p>
}

function buildRouter(user: { id: string } | null) {
  const rootRoute = createRootRouteWithContext<object>()({
    // A fresh context object on every navigation, like the real root route.
    beforeLoad: () => ({ session: user ? { user: { ...user } } : null }),
    component: () => <Outlet />,
  })
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search as { page?: string },
    component: Card,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  })
}

describe('useEnsureAnonSession', () => {
  it('does not render its caller again for a navigation', async () => {
    cardRenders = 0
    const router = buildRouter({ id: 'user_1' })
    render(<RouterProvider router={router} />)
    await screen.findByText('card')
    const settled = cardRenders

    await act(() => router.navigate({ to: '/', search: { page: '2' } as never }))
    await act(() => router.navigate({ to: '/', search: { page: '3' } as never }))

    expect(router.state.location.search).toEqual({ page: '3' })
    expect(cardRenders).toBe(settled)
  })

  it('reports an existing session without signing in', async () => {
    const router = buildRouter({ id: 'user_1' })
    render(<RouterProvider router={router} />)
    await screen.findByText('card')

    await expect(ensure()).resolves.toBe(true)
    expect(anonymousSignIn).not.toHaveBeenCalled()
  })

  it('signs in anonymously when there is no session', async () => {
    const router = buildRouter(null)
    render(<RouterProvider router={router} />)
    await screen.findByText('card')

    await act(async () => {
      await expect(ensure()).resolves.toBe(true)
    })
    expect(anonymousSignIn).toHaveBeenCalledTimes(1)
  })
})
