/**
 * Beside the boards settings title, the words visitors see where they differ
 * from the admin's posts and boards.
 */
import { describe, expect, it } from 'vitest'
import { visitorWordsHint } from '../visitor-words'

describe('visitorWordsHint', () => {
  it('names each word visitors see that the admin does not', () => {
    expect(visitorWordsHint({ postWord: 'idea', boardWord: 'board' })).toBe('Visitors see ideas')
    expect(visitorWordsHint({ postWord: 'suggestion', boardWord: 'category' })).toBe(
      'Visitors see suggestions and categories'
    )
    expect(visitorWordsHint({ postWord: 'post', boardWord: 'category' })).toBe(
      'Visitors see categories'
    )
  })

  it('says nothing when visitors see posts and boards too', () => {
    expect(visitorWordsHint({ postWord: 'post', boardWord: 'board' })).toBeNull()
  })
})
