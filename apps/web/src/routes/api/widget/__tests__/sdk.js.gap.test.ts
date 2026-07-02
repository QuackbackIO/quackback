/**
 * Gap coverage for `GET /api/widget/sdk.js`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
}))

const configMock = vi.hoisted(() => ({
  isDev: false,
  baseUrl: 'https://default.example.com',
}))
vi.mock('@/lib/server/config', () => ({
  config: configMock,
}))

// The `?raw` bundle import must resolve to a string in the test env.
vi.mock('../../../../../../packages/widget/dist/browser.js?raw', () => ({
  default: 'WIDGET_BUNDLE',
}))

const getWidgetConfigMock = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: getWidgetConfigMock,
}))

import { Route } from '../sdk[.]js'

type Handler = (ctx: { request: Request }) => Promise<Response>
function getGET(): Handler {
  return (Route as unknown as { options: { server: { handlers: { GET: Handler } } } }).options
    .server.handlers.GET
}

beforeEach(() => {
  vi.clearAllMocks()
  configMock.isDev = false
  configMock.baseUrl = 'https://default.example.com'
  getWidgetConfigMock.mockResolvedValue({ enabled: true })
})

describe('GET /api/widget/sdk.js', () => {
  it('returns a disabled stub with short cache when widget disabled', async () => {
    getWidgetConfigMock.mockResolvedValueOnce({ enabled: false })
    const res = await getGET()({
      request: new Request('https://app.example.com/api/widget/sdk.js'),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Widget is disabled')
    expect(res.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60')
  })

  it('serves bundle with prelude using request origin (prod cache)', async () => {
    const res = await getGET()({
      request: new Request('https://app.example.com/api/widget/sdk.js'),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('window.__QUACKBACK_URL__="https://app.example.com"')
    // Prelude is prepended to the real widget bundle string; ensure body
    // extends beyond just the prelude.
    expect(body.length).toBeGreaterThan(
      'window.__QUACKBACK_URL__="https://app.example.com";'.length
    )
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(res.headers.get('Vary')).toBe('Host, X-Forwarded-Host, X-Forwarded-Proto')
  })

  it('uses no-store cache in dev', async () => {
    configMock.isDev = true
    const res = await getGET()({
      request: new Request('https://app.example.com/api/widget/sdk.js'),
    })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('honours x-forwarded-host and x-forwarded-proto', async () => {
    const req = new Request('https://internal/api/widget/sdk.js', {
      headers: {
        'x-forwarded-host': 'public.example.com',
        'x-forwarded-proto': 'https',
      },
    })
    const res = await getGET()({ request: req })
    const body = await res.text()
    expect(body).toContain('window.__QUACKBACK_URL__="https://public.example.com"')
  })

  it('defaults proto to url protocol when x-forwarded-proto missing', async () => {
    const req = new Request('http://internal/api/widget/sdk.js', {
      headers: { 'x-forwarded-host': 'fwd.example.com' },
    })
    const res = await getGET()({ request: req })
    const body = await res.text()
    expect(body).toContain('window.__QUACKBACK_URL__="http://fwd.example.com"')
  })
})
