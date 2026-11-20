// @vitest-environment node
/**
 * The section handoff is one GET route; `leg` picks the step. Each step's
 * response (its 302, cookies and no-referrer header) is returned untouched.
 */
import { describe, expect, it, vi } from 'vitest'

const legs = vi.hoisted(() => ({
  begin: vi.fn(async () => new Response(null, { status: 302, headers: { location: '/begin' } })),
  mint: vi.fn(async () => new Response(null, { status: 302, headers: { location: '/mint' } })),
  finish: vi.fn(async () => new Response(null, { status: 302, headers: { location: '/finish' } })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (opts: unknown) => ({ path, options: opts }),
}))

vi.mock('@/lib/server/auth/section-handoff', () => ({
  beginSectionHandoff: legs.begin,
  mintSectionHandoff: legs.mint,
  finishSectionHandoff: legs.finish,
}))

const { Route } = await import('../auth.section-handoff')

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
const GET = (Route as unknown as { options: { server: { handlers: Handlers } } }).options.server
  .handlers.GET

describe('section handoff route', () => {
  it('is served at /auth/section-handoff', () => {
    expect((Route as unknown as { path: string }).path).toBe('/auth/section-handoff')
  })

  it.each([
    ['', 'begin'],
    ['&leg=mint', 'mint'],
    ['&leg=finish', 'finish'],
    ['&leg=unknown', 'begin'],
  ] as const)('query %s answers with the %s step', async (query, leg) => {
    for (const fn of Object.values(legs)) fn.mockClear()
    const request = new Request(`https://help.acme.com/auth/section-handoff?returnTo=%2F${query}`)
    const response = await GET({ request })
    expect(legs[leg]).toHaveBeenCalledWith(request)
    for (const [name, fn] of Object.entries(legs)) {
      if (name !== leg) expect(fn).not.toHaveBeenCalled()
    }
    expect(response.headers.get('location')).toBe(`/${leg}`)
  })
})
