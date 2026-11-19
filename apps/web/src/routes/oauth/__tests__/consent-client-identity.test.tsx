// @vitest-environment happy-dom
/**
 * The consent screen shows what the server vouches for about the client, not
 * only what the client says about itself. A CIMD client shows the verified host
 * of its client_id URL; any other client is marked unverified and shows where
 * the authorization code will go.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
import { Route as ConsentRoute } from '@/routes/oauth/consent'

const SEARCH =
  '/oauth/consent?client_id=CLIENT&redirect_uri=https%3A%2F%2Fchat.example.com%2Fcb&scope=openid%20read%3Afeedback'

async function renderConsent(client: Record<string, unknown>) {
  const request = vi.fn(async (input: string | URL | Request) => {
    if (String(input).startsWith('/api/auth/oauth2/public-client?')) return Response.json(client)
    throw new Error(`Unexpected request: ${String(input)}`)
  })
  vi.stubGlobal('fetch', request)
  vi.spyOn(console, 'error').mockImplementation(() => {})

  const rootRoute = createRootRouteWithContext<RouterContext>()({ component: () => <Outlet /> })
  const consentRoute = createRoute({
    getParentRoute: () => rootRoute as never,
    path: '/oauth/consent',
    validateSearch: ConsentRoute.options.validateSearch,
    loader: ConsentRoute.options.loader,
    component: ConsentRoute.options.component,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([consentRoute]),
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [SEARCH] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
  return request
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('consent client identity', () => {
  it('asks for the identity of the redirect the authorize request named', async () => {
    const request = await renderConsent({ client_name: 'Chat' })
    const url = new URL(String(request.mock.calls[0]?.[0]), 'http://x')
    expect(url.searchParams.get('client_id')).toBe('CLIENT')
    expect(url.searchParams.get('redirect_uri')).toBe('https://chat.example.com/cb')
  })

  it('shows the verified host and where the code goes, with its link but never a logo', async () => {
    await renderConsent({
      client_name: 'ChatGPT',
      client_uri: 'https://chatgpt.com',
      logo_uri: 'https://chatgpt.com/logo.png',
      client_identity: {
        verified: true,
        host: 'chatgpt.com',
        redirect: { kind: 'web', host: 'chatgpt.com' },
      },
    })
    expect(screen.getByRole('heading', { name: 'ChatGPT' })).toBeInTheDocument()
    expect(screen.getByText(/Verified:/)).toHaveTextContent('Verified: chatgpt.com')
    expect(screen.getByRole('link', { name: 'chatgpt.com' })).toHaveAttribute(
      'href',
      'https://chatgpt.com'
    )
    expect(screen.getByText(/Sends you back to chatgpt\.com\./)).toBeInTheDocument()
    // Loading the logo would tell the client's host who is consenting, and when.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText('Unverified app')).not.toBeInTheDocument()
    expect(screen.queryByText(/may not be who it says/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Only continue if/)).not.toBeInTheDocument()
  })

  it('warns when a verified client sends the code to an app on this device', async () => {
    await renderConsent({
      client_name: 'Visual Studio Code',
      client_identity: { verified: true, host: 'vscode.dev', redirect: { kind: 'device' } },
    })
    expect(screen.getByText(/Verified:/)).toHaveTextContent('Verified: vscode.dev')
    expect(screen.getByText(/Sends you back to an app on this device\./)).toBeInTheDocument()
    expect(
      screen.getByText('Only continue if you started this from an app on this device yourself.')
    ).toBeInTheDocument()
  })

  it('marks a self-registered client unverified, and hides the logo and link it chose', async () => {
    await renderConsent({
      client_name: 'ChatGPT',
      client_uri: 'https://chatgpt.com',
      logo_uri: 'https://chatgpt.com/logo.png',
      client_identity: { verified: false, redirect: { kind: 'web', host: 'attacker.example' } },
    })
    expect(screen.getByRole('heading', { name: 'ChatGPT' })).toBeInTheDocument()
    expect(screen.getByText('Unverified app')).toBeInTheDocument()
    expect(
      screen.getByText(/This app chose its own name, so it may not be who it says\./)
    ).toHaveTextContent(/Sends you back to attacker\.example\./)
    expect(screen.queryByText(/Verified:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /chatgpt\.com/ })).not.toBeInTheDocument()
  })

  it('says a loopback redirect goes to an app on this device', async () => {
    await renderConsent({
      client_name: 'Claude Code',
      client_identity: { verified: false, redirect: { kind: 'device' } },
    })
    expect(screen.getByText(/Sends you back to an app on this device\./)).toBeInTheDocument()
    expect(screen.getByText(/Only continue if you started this/)).toBeInTheDocument()
  })

  it('names the app scheme of a private-use redirect', async () => {
    await renderConsent({
      client_name: 'Cursor',
      client_identity: { verified: false, redirect: { kind: 'app', scheme: 'cursor' } },
    })
    expect(
      screen.getByText(/Sends you back to the cursor app on this device\./)
    ).toBeInTheDocument()
  })

  it('treats a response without identity as unverified', async () => {
    await renderConsent({ client_name: 'Old server' })
    expect(screen.getByText('Unverified app')).toBeInTheDocument()
    expect(screen.queryByText(/Sends you back/)).not.toBeInTheDocument()
  })
})
