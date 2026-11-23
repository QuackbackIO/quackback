import { describe, expect, it } from 'vitest'
import { canWidenSearch, resolvePostSearchMode, searchTerms, shorterStems } from '../post.search'

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
  it('widens plain words, never a query with search operators', () => {
    expect(canWidenSearch('zap')).toBe(true)
    expect(canWidenSearch('csv export option')).toBe(true)
    expect(canWidenSearch('"dark mode"')).toBe(false)
    expect(canWidenSearch('slack -email')).toBe(false)
    expect(canWidenSearch('slack OR teams')).toBe(false)
    expect(canWidenSearch('slack or teams')).toBe(false)
    expect(canWidenSearch('kaye@acme.io sign in')).toBe(false)
    expect(canWidenSearch('node.js sdk')).toBe(false)
    expect(canWidenSearch('co-op discount')).toBe(true)
    expect(canWidenSearch('&&&')).toBe(false)
    expect(canWidenSearch(undefined)).toBe(false)
  })
})

describe('resolvePostSearchMode', () => {
  /** A probe that finds matches only in the given modes, and records each ask. */
  function probe(...matching: string[]) {
    const asked: string[] = []
    const hasMatch = async (mode: string) => {
      asked.push(mode)
      return matching.includes(mode)
    }
    return { asked, hasMatch }
  }

  it('keeps every word when some post has them all', async () => {
    const { asked, hasMatch } = probe('all', 'most', 'similar')
    expect(await resolvePostSearchMode('csv export', hasMatch)).toBe('all')
    expect(asked).toEqual(['all'])
  })

  it('falls back to half the words, then to a close spelling', async () => {
    expect(await resolvePostSearchMode('csv export option', probe('most').hasMatch)).toBe('most')
    expect(await resolvePostSearchMode('integraton', probe('similar').hasMatch)).toBe('similar')
  })

  it('skips half the words for a single word', async () => {
    const { asked, hasMatch } = probe()
    expect(await resolvePostSearchMode('zap', hasMatch)).toBe('all')
    expect(asked).toEqual(['all', 'similar'])
  })

  it('never probes a query with search operators', async () => {
    const { asked, hasMatch } = probe('similar')
    expect(await resolvePostSearchMode('"dark mode"', hasMatch)).toBe('all')
    expect(asked).toEqual([])
  })
})

describe('shorterStems', () => {
  it('tries the few shorter starts a partial word may be stored as', () => {
    expect(shorterStems('integrati', 0)).toContain('integr')
    expect(shorterStems('notifica', 0)).toContain('notif')
  })

  it('tries nothing a whole word or a short word does not need', () => {
    expect(shorterStems('users', 0)).toEqual([])
    expect(shorterStems('apple', 0)).toEqual([])
    expect(shorterStems('copy', 0)).toEqual([])
    // Never a stem common to many words.
    expect(shorterStems('integration', 0)).toEqual([
      'integra',
      'integrat',
      'integrati',
      'integratio',
    ])
  })

  it('keeps the query small: no long words, and only the first few words', () => {
    expect(shorterStems('a'.repeat(33), 0)).toEqual([])
    expect(shorterStems('integrati', 5)).toEqual([])
    expect(shorterStems('w'.repeat(32), 0)).toHaveLength(4)
  })
})
