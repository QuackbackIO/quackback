import { describe, expect, it } from 'vitest'
import { generateId } from '@quackback/ids'
import { typeIdTarget } from '../targets'

describe('typeIdTarget', () => {
  it('records the current entity prefix for a retired alias id', () => {
    const canonical = generateId('article')
    const legacy = `kb_article_${canonical.slice('article_'.length)}`
    expect(typeIdTarget(canonical)).toEqual({ type: 'article', id: canonical })
    expect(typeIdTarget(legacy)).toEqual({ type: 'article', id: legacy })
  })

  it('ignores values that are not TypeIDs', () => {
    expect(typeIdTarget('not an id')).toBeNull()
    expect(typeIdTarget(42)).toBeNull()
  })
})
