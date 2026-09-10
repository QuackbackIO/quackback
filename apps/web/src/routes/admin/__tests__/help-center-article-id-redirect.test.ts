import { describe, expect, it } from 'vitest'
import { generateId } from '@quackback/ids'

const { Route } = await import('../help-center.articles.$articleId')

type BeforeLoadFn = (ctx: { params: { articleId: string } }) => void

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

describe('admin article editor legacy TypeID redirect', () => {
  it('replaces a bookmarked kb_article_ URL with article_', () => {
    const canonical = generateId('article')
    const legacy = `kb_article_${canonical.slice('article_'.length)}`
    const opts = catchRedirect(() => beforeLoad({ params: { articleId: legacy } }))
    expect(opts.to).toBe('/admin/help-center/articles/$articleId')
    expect(opts.params).toEqual({ articleId: canonical })
    expect(opts.replace).toBe(true)
  })

  it('leaves a canonical article_ URL alone', () => {
    const canonical = generateId('article')
    expect(beforeLoad({ params: { articleId: canonical } })).toBeUndefined()
  })
})
