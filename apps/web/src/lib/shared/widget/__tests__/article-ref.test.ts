import { describe, it, expect } from 'vitest'
import { generateId } from '@quackback/ids'
import { articleTypeIdToKbArticleId, isArticleTypeId } from '../article-ref'

describe('article TypeID refs', () => {
  it('treats article_ and kb_article_ as the same row', () => {
    const canonical = generateId('article')
    const legacy = `kb_article_${canonical.slice('article_'.length)}`
    expect(isArticleTypeId(canonical)).toBe(true)
    expect(isArticleTypeId(legacy)).toBe(true)
    expect(articleTypeIdToKbArticleId(legacy)).toBe(canonical)
    expect(articleTypeIdToKbArticleId(canonical)).toBe(canonical)
  })

  it('rejects slugs and the old art_ prefix', () => {
    expect(isArticleTypeId('pricing')).toBe(false)
    expect(isArticleTypeId('art_01h...')).toBe(false)
    expect(articleTypeIdToKbArticleId('pricing')).toBeNull()
  })
})
