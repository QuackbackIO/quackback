import { describe, it, expect } from 'vitest'
import { generateId } from '@quackback/ids'
import { articleTypeIdToKbArticleId, isArticleTypeId } from '../article-ref'

describe('article TypeID refs', () => {
  it('treats article_ and kb_article_ as the same row', () => {
    const stored = generateId('kb_article')
    const published = `article_${stored.slice('kb_article_'.length)}`
    expect(isArticleTypeId(stored)).toBe(true)
    expect(isArticleTypeId(published)).toBe(true)
    expect(articleTypeIdToKbArticleId(published)).toBe(stored)
    expect(articleTypeIdToKbArticleId(stored)).toBe(stored)
  })

  it('rejects slugs and the old art_ prefix', () => {
    expect(isArticleTypeId('pricing')).toBe(false)
    expect(isArticleTypeId('art_01h...')).toBe(false)
    expect(articleTypeIdToKbArticleId('pricing')).toBeNull()
  })
})
