import { describe, it, expect } from 'vitest'

const { Route } = await import('../settings.boards.index')

type BeforeLoadFn = (ctx: {
  context: { settings?: { featureFlags?: { feedback?: boolean } } }
  search: { board?: string; tab?: 'general' | 'access' | 'moderation' | 'import' | 'export' }
}) => void

const beforeLoad = Route.options.beforeLoad as BeforeLoadFn

function catchRedirect(fn: () => void): Record<string, unknown> {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(Response)
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  return (thrown as any).options as Record<string, unknown>
}

describe('settings.boards.index legacy deep-link redirect', () => {
  it('redirects ?board=slug to /admin/settings/boards/$slug', () => {
    const opts = catchRedirect(() =>
      beforeLoad({
        context: { settings: { featureFlags: { feedback: true } } },
        search: { board: 'bug-reports' },
      })
    )
    expect(opts.to).toBe('/admin/settings/boards/$slug')
    expect(opts.params).toEqual({ slug: 'bug-reports' })
    expect(opts.search).toEqual({})
  })

  it('carries ?tab= over to the detail page', () => {
    const opts = catchRedirect(() =>
      beforeLoad({
        context: { settings: { featureFlags: { feedback: true } } },
        search: { board: 'bug-reports', tab: 'access' },
      })
    )
    expect(opts.to).toBe('/admin/settings/boards/$slug')
    expect(opts.params).toEqual({ slug: 'bug-reports' })
    expect(opts.search).toEqual({ tab: 'access' })
  })

  it('does not redirect when board search is absent', () => {
    expect(() =>
      beforeLoad({
        context: { settings: { featureFlags: { feedback: true } } },
        search: {},
      })
    ).not.toThrow()
  })

  it('redirects to general settings when the feedback product is off', () => {
    const opts = catchRedirect(() =>
      beforeLoad({
        context: { settings: { featureFlags: { feedback: false } } },
        search: { board: 'bug-reports', tab: 'access' },
      })
    )
    expect(opts.to).toBe('/admin/settings/general')
  })
})
