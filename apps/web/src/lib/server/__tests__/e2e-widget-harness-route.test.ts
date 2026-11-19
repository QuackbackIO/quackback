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

import {
  isE2eWidgetHarnessEnabled,
  mintE2eWidgetHtml,
  parseE2eWidgetPersona,
} from '@/lib/server/e2e-widget-harness'
import { Route } from '../../../routes/e2e.widget'

const GET = (
  Route as unknown as {
    options: { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
  }
).options.server.handlers.GET

describe('GET /e2e/widget', () => {
  it('returns 404 when the harness is disabled', async () => {
    vi.mocked(isE2eWidgetHarnessEnabled).mockReturnValue(false)
    const res = await GET({ request: new Request('http://acme.localhost:3000/e2e/widget') })
    expect(res.status).toBe(404)
    expect(mintE2eWidgetHtml).not.toHaveBeenCalled()
  })

  it('serves the SDK host page for the asked persona, never cached or indexed, when enabled', async () => {
    vi.mocked(isE2eWidgetHarnessEnabled).mockReturnValue(true)
    vi.mocked(parseE2eWidgetPersona).mockReturnValue('customer')
    vi.mocked(mintE2eWidgetHtml).mockResolvedValue('<html>signed customer</html>')
    const res = await GET({
      request: new Request('http://acme.localhost:3000/e2e/widget?persona=customer'),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(await res.text()).toBe('<html>signed customer</html>')
    expect(parseE2eWidgetPersona).toHaveBeenCalledWith('customer')
    expect(mintE2eWidgetHtml).toHaveBeenCalledWith('customer', 'http://acme.localhost:3000')
  })
})
