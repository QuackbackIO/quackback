import { describe, expect, it } from 'vitest'
import { generateId } from '@quackback/ids'

const { Route } = await import('../help-center.articles.$articleId')

type BeforeLoadFn = (ctx: { params: { articleId: string } }) => void

const beforeLoad = Route.options.beforeLoad as unknown as BeforeLoadFn

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

describe('admin article editor bookmark redirect', () => {
  it('opens a bookmarked kb_article_ URL as the list modal', () => {
    const canonical = generateId('article')
    const legacy = `kb_article_${canonical.slice('article_'.length)}`
    const opts = catchRedirect(() => beforeLoad({ params: { articleId: legacy } }))
    expect(opts.to).toBe('/admin/help-center')
    expect(opts.search).toEqual({ article: canonical })
    expect(opts.replace).toBe(true)
  })

  it('opens a canonical article_ URL as the list modal', () => {
    const canonical = generateId('article')
    const opts = catchRedirect(() => beforeLoad({ params: { articleId: canonical } }))
    expect(opts.to).toBe('/admin/help-center')
    expect(opts.search).toEqual({ article: canonical })
    expect(opts.replace).toBe(true)
  })
})
