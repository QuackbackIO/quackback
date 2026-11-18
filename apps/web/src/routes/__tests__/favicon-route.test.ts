// @vitest-environment node
/**
 * Pages without their own icon link (admin, onboarding) make the browser ask
 * for /favicon.ico. There is no such file, so before setup is finished the
 * onboarding guard used to answer it with a redirect into the setup page.
 * The route answers it with the app's icon instead.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (opts: unknown) => ({ path, options: opts }),
}))

import { Route } from '../favicon[.]ico'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> | Response }
const { GET } = (Route as unknown as { options: { server: { handlers: Handlers } } }).options.server
  .handlers

describe('/favicon.ico', () => {
  it('redirects to the app icon, not into onboarding', async () => {
    const response = await GET({ request: new Request('https://acme.example/favicon.ico') })
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/logo.png')
  })

  it('lets browsers cache the answer', async () => {
    const response = await GET({ request: new Request('https://acme.example/favicon.ico') })
    expect(response.headers.get('Cache-Control')).toMatch(/max-age=\d+/)
  })
})
