// @vitest-environment happy-dom
/**
 * Differential-coverage test for the OAuth consent page — groupScopes (scope →
 * read/write/manage group mapping) and the loaded-state permission rows.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const routeData = vi.hoisted(() => ({ useSearch: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg, useSearch: routeData.useSearch }),
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}))
vi.mock('lucide-react', () => ({
  ExternalLink: () => null,
  Globe: () => null,
  ShieldCheck: () => null,
}))

const { Route } = await import('../consent')
const ConsentPage = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component

beforeEach(() => {
  vi.restoreAllMocks()
  routeData.useSearch.mockReturnValue({
    client_id: 'client_1',
    scope: 'read:feedback write:feedback openid offline_access',
  })
})
afterEach(() => vi.restoreAllMocks())

describe('ConsentPage', () => {
  it('maps scopes into permission groups and renders them once the client loads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ client_name: 'My App', client_uri: 'https://app.example.com' }),
        { status: 200 }
      )
    )
    render(<ConsentPage />)
    // groupScopes ran during render — Feedback group (read+write) is shown after load
    await waitFor(() => expect(screen.getByText('My App')).toBeInTheDocument())
    expect(screen.getByText('Feedback')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
  })

  it('handles a client fetch failure by rendering the fallback name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('nope', { status: 500 }))
    render(<ConsentPage />)
    await waitFor(() => expect(screen.getByText('An application')).toBeInTheDocument())
  })
})
