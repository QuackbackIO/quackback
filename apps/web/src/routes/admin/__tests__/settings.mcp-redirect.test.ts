import { describe, it, expect } from 'vitest'

const { Route } = await import('../settings.mcp')

type BeforeLoadFn = (ctx: unknown) => void

describe('settings.mcp route', () => {
  it('redirects to the Assistants page', () => {
    let thrown: unknown
    try {
      ;(Route.options.beforeLoad as BeforeLoadFn)({ location: { searchStr: '' } })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Response)
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = (thrown as any).options as Record<string, unknown>
    expect(opts.href).toBe('/admin/settings/agents/assistants')
  })
})
