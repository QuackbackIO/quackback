import { describe, expect, it } from 'vitest'
import { emojiSuggestionLabel, splitQueryHighlights } from '../highlight-query'

describe('splitQueryHighlights', () => {
  it('returns the whole string unmatched when the query is empty', () => {
    expect(splitQueryHighlights(':crossed_fingers:', '')).toEqual([
      { text: ':crossed_fingers:', match: false },
    ])
  })

  it('highlights every case-insensitive hit (Slack :fingers → crossed_fingers)', () => {
    expect(splitQueryHighlights('crossed_fingers', 'Fingers')).toEqual([
      { text: 'crossed_', match: false },
      { text: 'fingers', match: true },
    ])
  })

  it('highlights a prefix hit', () => {
    expect(splitQueryHighlights('fingers_crossed', 'finger')).toEqual([
      { text: 'finger', match: true },
      { text: 's_crossed', match: false },
    ])
  })

  it('leaves the string unmatched when the query is not present', () => {
    expect(splitQueryHighlights('tada', 'finger')).toEqual([{ text: 'tada', match: false }])
  })
})

describe('emojiSuggestionLabel', () => {
  const crossed = { name: 'crossed_fingers', shortcodes: ['fingers_crossed'] }

  it('uses the primary shortcode when there is no query', () => {
    expect(emojiSuggestionLabel(crossed, '')).toBe('fingers_crossed')
  })

  it('prefers the name when it contains the query (Slack :crossed_fingers:)', () => {
    expect(emojiSuggestionLabel(crossed, 'fingers')).toBe('crossed_fingers')
  })

  it('falls back to a matching shortcode when the name does not match', () => {
    expect(emojiSuggestionLabel({ name: 'spock', shortcodes: ['vulcan'] }, 'vulc')).toBe('vulcan')
  })
})
