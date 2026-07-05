import { describe, it, expect } from 'vitest'

const { Route } = await import('../settings.security.sso')

 
type BeforeLoadFn = (ctx: unknown) => void

describe('settings.security.sso route', () => {
  it('redirects to /admin/settings/security/authentication?tab=sign-in', () => {
    let thrown: unknown
    try {
      ;(Route.options.beforeLoad as BeforeLoadFn)({})
    } catch (e) {
      thrown = e
    }
    // TanStack Router redirect() returns a Response with an .options bag.
    expect(thrown).toBeInstanceOf(Response)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = (thrown as any).options as Record<string, unknown>
    expect(opts.to).toBe('/admin/settings/security/authentication')
    expect(opts.search).toEqual({ tab: 'sign-in' })
  })
})
