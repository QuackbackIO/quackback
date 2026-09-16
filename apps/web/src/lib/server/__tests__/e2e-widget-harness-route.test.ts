import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/e2e-widget-harness', () => ({
  isE2eWidgetHarnessEnabled: vi.fn(() => false),
  parseE2eWidgetPersona: vi.fn(() => 'anon'),
  mintE2eWidgetHtml: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () => (opts: { server: { handlers: { GET: (args: unknown) => Promise<Response> } } }) => ({
      options: opts,
    }),
}))

import { isE2eWidgetHarnessEnabled } from '@/lib/server/e2e-widget-harness'
import { Route } from '../../../routes/e2e.widget'

describe('GET /e2e/widget', () => {
  it('returns 404 when the harness is disabled', async () => {
    vi.mocked(isE2eWidgetHarnessEnabled).mockReturnValue(false)
    const GET = (
      Route as unknown as {
        options: { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
      }
    ).options.server.handlers.GET
    const res = await GET({ request: new Request('http://acme.localhost:3000/e2e/widget') })
    expect(res.status).toBe(404)
  })
})
