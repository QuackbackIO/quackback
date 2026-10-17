import { describe, expect, it } from 'vitest'
import { canWidenSearch, resolvePostSearchMode, searchTerms } from '../post.search'

describe('searchTerms', () => {
  it('splits on anything that is not a letter or digit, and lowercases', () => {
    expect(searchTerms('Zapier/CSV-export, v2!')).toEqual(['zapier', 'csv', 'export', 'v2'])
  })

  it('keeps letters from any script', () => {
    expect(searchTerms('Übersicht 日本語')).toEqual(['übersicht', '日本語'])
  })

  it('drops tsquery syntax, so the words are always safe to search', () => {
    expect(searchTerms("a & b | !c:* 'd'")).toEqual(['a', 'b', 'c', 'd'])
  })

  it('caps the number of words', () => {
    expect(searchTerms('a b c d e f g h i j k l')).toHaveLength(10)
  })
})

describe('canWidenSearch', () => {
  it('only widens a search of two or more plain words', () => {
    expect(canWidenSearch('zap')).toBe(false)
    expect(canWidenSearch('csv export option')).toBe(true)
    expect(canWidenSearch('"dark mode"')).toBe(false)
    expect(canWidenSearch('slack -email')).toBe(false)
    expect(canWidenSearch('slack OR teams')).toBe(false)
    expect(canWidenSearch(undefined)).toBe(false)
  })
})

describe('resolvePostSearchMode', () => {
  it('keeps all words when some post has them all', async () => {
    expect(await resolvePostSearchMode('csv export', async () => true)).toBe('all')
  })

  it('falls back to half the words when no post has them all', async () => {
    expect(await resolvePostSearchMode('csv export option', async () => false)).toBe('most')
  })

  it('does not probe a single word', async () => {
    let probed = false
    await resolvePostSearchMode('zap', async () => (probed = true))
    expect(probed).toBe(false)
  })
})
