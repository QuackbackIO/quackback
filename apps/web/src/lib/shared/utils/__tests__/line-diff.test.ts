import { describe, expect, it } from 'vitest'
import { lineDiff } from '../line-diff'

describe('lineDiff', () => {
  it('keeps common lines and marks removed and added ones in order', () => {
    expect(
      lineDiff('Title\nOpen Settings.\nDone', 'Title\nOpen Settings, then Account.\nDone')
    ).toEqual([
      { kind: 'same', text: 'Title' },
      { kind: 'removed', text: 'Open Settings.' },
      { kind: 'added', text: 'Open Settings, then Account.' },
      { kind: 'same', text: 'Done' },
    ])
  })

  it('reports an unchanged text as all same', () => {
    expect(lineDiff('a\nb', 'a\nb').every((l) => l.kind === 'same')).toBe(true)
  })

  it('falls back to removed then added past the size limit', () => {
    expect(lineDiff('a\nb', 'c', 1)).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'c' },
    ])
  })
})
