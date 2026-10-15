// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import type { RouterContext } from '@/routes/__root'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { Route as ConsentRoute } from '@/routes/oauth/consent'

const client = { client_name: 'MCP test client', client_uri: 'https://example.com' }

async function renderConsent(locale?: SupportedLocale) {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => <Outlet />,
  })
  const consentRoute = createRoute({
    getParentRoute: () => rootRoute as never,
    path: '/oauth/consent',
    validateSearch: ConsentRoute.options.validateSearch,
    loader: ConsentRoute.options.loader,
    component: ConsentRoute.options.component,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([consentRoute]),
    context: { queryClient: new QueryClient(), acceptLanguageLocale: locale },
    history: createMemoryHistory({
      initialEntries: ['/oauth/consent?client_id=test-client&scope=openid%20read:feedback'],
    }),
    defaultErrorComponent: ({ error }) => (
      <div role="alert">{error instanceof Error ? error.message : String(error)}</div>
    ),
  })
  await router.load()
  // The route supplies its own intl provider, as it must outside /admin and /_portal.
  render(<RouterProvider router={router} />)
  await waitFor(() => {
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: client.client_name })).toBeInTheDocument()
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mockRequests() {
  const request = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    if (String(input).startsWith('/api/auth/oauth2/public-client?')) {
      return Response.json(client)
    }
    if (input === '/api/auth/oauth2/consent') return Response.json({})
    throw new Error(`Unexpected request: ${String(input)}`)
  })
  vi.stubGlobal('fetch', request)
  // React logs render failures before the router catches them on a regression.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return request
}

describe('standalone MCP consent intl', () => {
  it('renders the real capability picker without an ancestor provider', async () => {
    mockRequests()
    await renderConsent()

    expect(screen.getByRole('button', { name: 'Settings: Read' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Authorize' })).toBeEnabled()
  })

  it('keeps the English picker copy consistent with the standalone page for other locales', async () => {
    mockRequests()
    await renderConsent('de')

    expect(screen.getByRole('button', { name: 'Settings: Read' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Authorize' })).toBeEnabled()
  })

  it('can select write access and authorize after client information loads', async () => {
    const request = mockRequests()
    await renderConsent('en')

    fireEvent.click(screen.getByRole('button', { name: 'Settings: Read and write' }))
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }))

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('/api/auth/oauth2/consent', expect.any(Object))
    })
    const consent = request.mock.calls.find(([input]) => input === '/api/auth/oauth2/consent')
    const body = JSON.parse((consent?.[1] as RequestInit).body as string)
    expect(body.accept).toBe(true)
    expect(body.scope.split(' ')).toContain('write:settings')
  })

  it('can deny access after client information loads', async () => {
    const request = mockRequests()
    await renderConsent('en')

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('/api/auth/oauth2/consent', expect.any(Object))
    })
    const consent = request.mock.calls.find(([input]) => input === '/api/auth/oauth2/consent')
    const body = JSON.parse((consent?.[1] as RequestInit).body as string)
    expect(body).toMatchObject({ accept: false, scope: 'openid read:feedback' })
  })
})
