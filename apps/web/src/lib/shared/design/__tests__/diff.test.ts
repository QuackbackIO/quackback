/**
 * What a draft changes against the published design, leaf by leaf, for the
 * draft bar's count and the review before publishing.
 */
import { describe, expect, it } from 'vitest'
import { designChanges, shownChanges } from '../diff'
import { defaultDesign } from '../schema'

describe('designChanges', () => {
  it('lists each changed leaf with its value before and after', () => {
    const before = defaultDesign()
    const after = defaultDesign()
    after.brand.light.accent = '#0f766e'
    after.layout.density = 'compact'
    expect(designChanges(before, after)).toEqual([
      { path: 'brand.light.accent', before: before.brand.light.accent, after: '#0f766e' },
      { path: 'layout.density', before: 'comfortable', after: 'compact' },
    ])
  })

  it('treats a list as one value and notes added and removed keys', () => {
    const before = defaultDesign()
    const after = defaultDesign()
    after.brand.light.surface = '#fafafa'
    after.nav.items = after.nav.items.slice(1)
    const changes = designChanges(before, after)
    expect(changes).toContainEqual({
      path: 'brand.light.surface',
      before: undefined,
      after: '#fafafa',
    })
    expect(changes.filter((c) => c.path === 'nav.items')).toHaveLength(1)
  })

  it('has nothing to say about identical designs', () => {
    expect(designChanges(defaultDesign(), defaultDesign())).toEqual([])
  })

  it('reads a list the same whatever order its items’ keys are in', () => {
    // A block given its id after it was read has the id last; one read with its id has it second.
    const read = {
      pages: { home: { blocks: [{ type: 'status', id: 'status001', grid: { x: 0 } }] } },
    }
    const named = {
      pages: { home: { blocks: [{ type: 'status', grid: { x: 0 }, id: 'status001' }] } },
    }
    expect(designChanges(read, named)).toEqual([])
    named.pages.home.blocks[0]!.grid.x = 4
    expect(designChanges(read, named)).toHaveLength(1)
  })
})

describe('shownChanges', () => {
  it('never lists when a match ran, or the face it could not match', () => {
    const before = defaultDesign()
    const after = defaultDesign()
    after.brand.matchedAt = '2026-11-10T06:13:54.644Z'
    after.brand.unmatchedFont = { family: 'Acme Grotesk', slot: 'heading' }
    after.brand.light.accent = '#0058a3'
    expect(shownChanges(before, after).map((change) => change.path)).toEqual(['brand.light.accent'])
    // The draft still differs: only the list leaves them out.
    expect(designChanges(before, after).length).toBeGreaterThan(1)
  })
})
