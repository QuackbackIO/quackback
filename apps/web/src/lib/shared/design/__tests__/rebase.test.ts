/**
 * A design the server saved from an older draft, on top of the draft as it
 * is now: the server's own changes move across, the person's stay, and the
 * person's win where both changed the same thing.
 */
import { describe, expect, it } from 'vitest'
import { rebaseOnto } from '../rebase'

type Doc = { a: number; b: number; blocks: Array<{ id: string; title: string; tone: string }> }

const base: Doc = {
  a: 1,
  b: 1,
  blocks: [
    { id: 'x', title: 'X', tone: 'plain' },
    { id: 'y', title: 'Y', tone: 'plain' },
  ],
}
const copy = (over: (doc: Doc) => void) => {
  const doc = structuredClone(base)
  over(doc)
  return doc
}

describe('rebaseOnto', () => {
  it('is the server’s design itself when nothing changed meanwhile', () => {
    const theirs = copy((d) => void (d.a = 2))
    expect(rebaseOnto(base, theirs, base)).toBe(theirs)
    expect(rebaseOnto(base, theirs, structuredClone(base))).toBe(theirs)
  })

  it('puts the server’s changes on the person’s', () => {
    const theirs = copy((d) => void (d.a = 2))
    const mine = copy((d) => void (d.b = 3))
    expect(rebaseOnto(base, theirs, mine)).toMatchObject({ a: 2, b: 3 })
  })

  it('keeps the person’s change where both changed the same thing', () => {
    const theirs = copy((d) => void (d.a = 2))
    const mine = copy((d) => void (d.a = 5))
    expect(rebaseOnto(base, theirs, mine).a).toBe(5)
  })

  it('changes a list item only while it is still the same item', () => {
    const theirs = copy((d) => void (d.blocks[1]!.tone = 'bold'))
    // Another field of the same block, by hand: both stay.
    const edited = copy((d) => void (d.blocks[1]!.title = 'Why'))
    expect(rebaseOnto(base, theirs, edited).blocks[1]).toEqual({
      id: 'y',
      title: 'Why',
      tone: 'bold',
    })
    // The blocks swapped by hand: the change never lands on the wrong block.
    const swapped = copy((d) => void d.blocks.reverse())
    const result = rebaseOnto(base, theirs, swapped)
    expect(result.blocks.map((b) => b.tone)).toEqual(['plain', 'plain'])
    // A block added by hand: the list is the person's.
    const added = copy((d) => void d.blocks.push({ id: 'z', title: 'Z', tone: 'plain' }))
    expect(rebaseOnto(base, theirs, added).blocks).toEqual(added.blocks)
  })
})
