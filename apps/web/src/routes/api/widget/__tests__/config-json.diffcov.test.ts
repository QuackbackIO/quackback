/**
 * Differential-coverage tests for GET /api/widget/config.json — disabled
 * projection, branding + custom-CSS theme extraction (oklch→hex + :root/.dark
 * blocks), and the branding-failure fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  resolveWidgetContext: vi.fn(),
  getBrandingConfig: vi.fn(),
  getCustomCss: vi.fn(),
  oklchToHex: vi.fn((v: string) => `#hex(${v})`),
}))
vi.mock('@/lib/server/widget/context', () => ({
  resolveWidgetContext: (...a: unknown[]) => m.resolveWidgetContext(...a),
}))
vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  getBrandingConfig: () => m.getBrandingConfig(),
  getCustomCss: () => m.getCustomCss(),
}))
vi.mock('@/lib/shared/theme/colors', () => ({ oklchToHex: (v: string) => m.oklchToHex(v) }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
}))

import { Route } from '../config[.]json'

type RouteShape = {
  options: { server: { handlers: { GET: (c: { request: Request }) => Promise<Response> } } }
}
const GET = (Route as unknown as RouteShape).options.server.handlers.GET
const req = () => new Request('https://x.test/api/widget/config.json?app=k&env=prod')

beforeEach(() => {
  vi.clearAllMocks()
  m.resolveWidgetContext.mockResolvedValue({
    publicConfig: { enabled: true, tabs: {}, hmacRequired: false, ticketing: { enabled: true } },
    source: 'global',
    contextToken: 'tok',
  })
  m.getBrandingConfig.mockResolvedValue({
    themeMode: 'user',
    light: { primary: 'oklch(1 0 0)', primaryForeground: 'oklch(0 0 0)', radius: '8px' },
    dark: { primary: 'oklch(.2 0 0)', primaryForeground: 'oklch(.9 0 0)' },
  })
  m.getCustomCss.mockResolvedValue('')
})

describe('config.json GET', () => {
  it('returns a disabled projection when the widget is off', async () => {
    m.resolveWidgetContext.mockResolvedValueOnce({
      publicConfig: { enabled: false },
      source: 'profile',
      contextToken: 'tok',
    })
    const res = await GET({ request: req() })
    expect((await res.json()).enabled).toBe(false)
  })
  it('builds the theme from branding + custom CSS overrides (oklch + hex)', async () => {
    m.getCustomCss.mockResolvedValueOnce(
      ':root { --primary: oklch(.5 0 0); --primary-foreground: #ffffff; --radius: 12px } .dark { --primary: #000000; --primary-foreground: oklch(.1 0 0) }'
    )
    const res = await GET({ request: req() })
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.theme).toBeDefined()
    expect(body.ticketing).toEqual({ enabled: true })
  })
  it('falls back to an empty theme when branding lookup throws', async () => {
    m.getBrandingConfig.mockRejectedValueOnce(new Error('boom'))
    const res = await GET({ request: req() })
    expect((await res.json()).enabled).toBe(true)
  })
})
