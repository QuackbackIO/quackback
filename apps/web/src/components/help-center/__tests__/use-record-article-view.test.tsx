// @vitest-environment happy-dom
/**
 * The canonical article page counts one view per article it shows. It counts
 * from the page itself rather than its loader, because the loader also runs
 * when a link is hovered (preload), which is not a visit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const recordView = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('@/lib/server/functions/help-center', () => ({
  recordPublicArticleViewFn: recordView,
}))

import { useRecordArticleView } from '../use-record-article-view'

function Page({ articleId }: { articleId: string }) {
  useRecordArticleView(articleId)
  return null
}

afterEach(() => {
  cleanup()
  recordView.mockClear()
})

describe('useRecordArticleView', () => {
  it('counts once per article shown, not per render', () => {
    const { rerender } = render(<Page articleId="kb_article_1" />)
    rerender(<Page articleId="kb_article_1" />)
    expect(recordView).toHaveBeenCalledTimes(1)
    expect(recordView).toHaveBeenCalledWith({ data: { articleId: 'kb_article_1' } })

    rerender(<Page articleId="kb_article_2" />)
    expect(recordView).toHaveBeenCalledTimes(2)
  })
})
