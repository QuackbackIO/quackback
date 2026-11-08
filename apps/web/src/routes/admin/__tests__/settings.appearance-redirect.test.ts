import { describe, it, expect } from 'vitest'

const { Route } = await import('../settings.appearance')

type BeforeLoadFn = (ctx: unknown) => void

describe('settings.appearance route', () => {
  it('redirects to Settings > Portal, as /branding does', () => {
    let thrown: unknown
    try {
      ;(Route.options.beforeLoad as BeforeLoadFn)({})
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Response)
    const { options } = thrown as Response & { options: { to?: string } }
    expect(options.to).toBe('/admin/settings/portal')
  })
})
