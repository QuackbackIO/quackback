import { describe, it, expect } from 'vitest'
import { splitByTerms, parseMarkdownLite } from '../ask-ai-text'

describe('splitByTerms', () => {
  it('marks case-insensitive term matches', () => {
    expect(splitByTerms('Invite your Team today', 'team invite')).toEqual([
      { text: 'Invite', match: true },
      { text: ' your ', match: false },
      { text: 'Team', match: true },
      { text: ' today', match: false },
    ])
  })

  it('returns the whole text unmarked when the query is empty', () => {
    expect(splitByTerms('Hello world', '   ')).toEqual([{ text: 'Hello world', match: false }])
  })

  it('is safe against regex metacharacters in the query', () => {
    expect(splitByTerms('a+b equals c', 'a+b (')).toEqual([
      { text: 'a+b', match: true },
      { text: ' equals c', match: false },
    ])
  })

  it('ignores single-character noise terms', () => {
    expect(splitByTerms('a big cat', 'a big')).toEqual([
      { text: 'a ', match: false },
      { text: 'big', match: true },
      { text: ' cat', match: false },
    ])
  })
})

// The grammar itself is pinned once in lib/shared/assistant/__tests__/
// markdown-lite.test.ts; these pin this surface's binding of it.
describe('parseMarkdownLite (Ask AI binding)', () => {
  it('parses bold runs and [n] citation markers', () => {
    expect(parseMarkdownLite('Click **Invite** [3].')).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [
            { text: 'Click ' },
            { text: 'Invite', bold: true },
            { text: ' ' },
            { text: '3', cite: 3 },
            { text: '.' },
          ],
        ],
      },
    ])
  })

  it('leaves italic markers literal (this surface renders them as-is)', () => {
    expect(parseMarkdownLite('A *subtle* hint.')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'A *subtle* hint.' }]] },
    ])
  })
})
