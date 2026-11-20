/**
 * GET /api/export/companies (CSV) stays a paid analytics export: it refuses
 * with 402 when the plan's `analyticsExports` flag is off, unlike the
 * workspace export, which is never plan-gated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockGetTierLimits: vi.fn(),
  mockListCompanies: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: async () => ({ settings: { slug: 'acme' }, principal: { role: 'admin' } }),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))
vi.mock('@/lib/server/domains/companies', () => ({
  listCompanies: hoisted.mockListCompanies,
}))

async function get(): Promise<Response> {
  const mod = await import('../export.companies')
  const handler = (
    mod.Route.options as unknown as {
      server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } }
    }
  ).server.handlers.GET
  return handler({ request: new Request('https://app.test/api/export/companies') })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockListCompanies.mockResolvedValue([])
})

describe('GET /api/export/companies', () => {
  it('exports when the plan includes analytics exports', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue({ features: { analyticsExports: true } })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    expect(hoisted.mockListCompanies).toHaveBeenCalledOnce()
  })

  it('refuses on a plan without analytics exports', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue({ features: { analyticsExports: false } })
    const res = await get()
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ limit: 'features.analyticsExports' })
    expect(hoisted.mockListCompanies).not.toHaveBeenCalled()
  })
})
