// @vitest-environment node
/**
 * The three legs of the section handoff are plain GET handlers: each hands the
 * request to its leg in lib/server/auth/section-handoff.ts and returns that
 * response untouched (its 302, cookies and no-referrer header).
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

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
function getHandler(route: unknown): Handlers['GET'] {
  return (route as { options: { server: { handlers: Handlers } } }).options.server.handlers.GET
}

describe('section handoff routes', () => {
  it.each([
    ['../auth.section-handoff', '/auth/section-handoff', 'begin'],
    ['../auth.section-handoff-mint', '/auth/section-handoff-mint', 'mint'],
    ['../auth.section-handoff-finish', '/auth/section-handoff-finish', 'finish'],
  ] as const)('%s answers with its leg', async (modulePath, path, leg) => {
    const { Route } = (await import(/* @vite-ignore */ modulePath)) as { Route: unknown }
    expect((Route as { path: string }).path).toBe(path)
    const request = new Request(`https://help.acme.com${path}?returnTo=%2F`)
    const response = await getHandler(Route)({ request })
    expect(legs[leg]).toHaveBeenCalledWith(request)
    expect(response.headers.get('location')).toBe(`/${leg}`)
  })
})
