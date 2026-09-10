import { describe, expect, it } from 'vitest'
import { generateId } from '@quackback/ids'
import { helpCenterKeys } from '../help-center'

describe('helpCenterKeys.articleDetail', () => {
  it('uses the same cache key for article_ and retired kb_article_ ids', () => {
    const canonical = generateId('article')
    const legacy = `kb_article_${canonical.slice('article_'.length)}` as typeof canonical
    expect(helpCenterKeys.articleDetail(legacy)).toEqual(helpCenterKeys.articleDetail(canonical))
    expect(helpCenterKeys.articleDetail(canonical)).toEqual([
      'help-center',
      'articles',
      'detail',
      canonical,
    ])
  })
})
