/**
 * What a Home block's panel reads and writes: its usual words, its widths,
 * the elements it draws, and its look, shared by every Home block unless one
 * is set apart.
 */
import { describe, expect, it } from 'vitest'
import {
  LOOK_DEFAULTS,
  elementsOf,
  lookOutliers,
  matchLook,
  resetLook,
  sharedLook,
  usualWords,
  widthTiles,
  writeLook,
} from '../block-panel'
import { newBlock, type HomeBlock } from '@/lib/shared/design/home'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

function home(...blocks: HomeBlock[]): PortalDesign {
  const design = defaultDesign()
  design.pages.home.blocks = blocks
  return design
}
const block = (type: HomeBlock['type'], id: string, look?: HomeBlock['look']) =>
  ({ ...newBlock(type), id, ...(look ? { look } : {}) }) as HomeBlock

describe('the words a block draws when it has none of its own', () => {
  it('names Top posts by its sort, as the page does', () => {
    const ideas = { ...newBlock('ideas'), sort: 'trending' } as HomeBlock
    expect(usualWords(ideas).heading).toBe('Trending posts')
    expect(usualWords({ ...ideas, sort: 'new' } as HomeBlock).heading).toBe('Newest posts')
    expect(usualWords({ ...ideas, sort: 'top' } as HomeBlock).heading).toBe('Top posts')
  })

  it('gives Help search and Contact their drawn headings, not their names', () => {
    expect(usualWords(newBlock('help_search')).heading).toBe('How can we help?')
    expect(usualWords(newBlock('contact')).heading).toBe('Talk to us')
  })

  it('names a roadmap by the roadmap it shows', () => {
    expect(usualWords(newBlock('roadmap')).heading).toBe('Roadmap')
    expect(usualWords(newBlock('roadmap'), { roadmap: 'Mobile app' }).heading).toBe('Mobile app')
  })

  it('draws no heading for Welcome or Write a post', () => {
    expect(usualWords(newBlock('welcome')).heading).toBeNull()
    expect(usualWords(newBlock('composer')).heading).toBeNull()
  })

  it('says each block’s usual way on', () => {
    expect(usualWords(newBlock('ideas')).link).toBe('See all posts')
    expect(usualWords(newBlock('status')).link).toBe('View status')
    expect(usualWords(newBlock('welcome')).link).toBeNull()
  })
})

describe('a block’s widths', () => {
  it('offers a third, a half, two thirds and the full width, in columns', () => {
    expect(widthTiles(3).map(([w]) => w)).toEqual(['4', '6', '8', '12'])
    expect(widthTiles(3).map(([, name]) => name)).toEqual(['⅓', '½', '⅔', 'Full'])
  })

  it('offers none narrower than the block can be', () => {
    expect(widthTiles(4).map(([w]) => w)).toEqual(['4', '6', '8', '12'])
    expect(widthTiles(6).map(([w]) => w)).toEqual(['6', '8', '12'])
  })
})

describe('the elements a block draws', () => {
  it('lists vote boxes for Top posts and none for Status', () => {
    expect(elementsOf('ideas')).toContain('vote')
    expect(elementsOf('status')).not.toContain('vote')
  })

  it('lists fields for Help search alone of the lists', () => {
    expect(elementsOf('help_search')).toContain('input')
    expect(elementsOf('help_topics')).not.toContain('input')
  })

  it('lists only elements a block can take a look for', () => {
    for (const type of ['welcome', 'ideas', 'roadmap', 'links'] as const)
      expect(elementsOf(type).length).toBeGreaterThan(0)
  })
})

describe('a block’s look, shared by every Home block', () => {
  it('writes every block that takes a look, the composer aside', () => {
    const design = home(
      block('ideas', 'aaaaaaaa'),
      block('status', 'bbbbbbbb'),
      block('composer', 'cccccccc')
    )
    writeLook(design, 'every', 'aaaaaaaa', 'tone', 'tint')
    expect(design.pages.home.blocks.map((b) => b.look?.tone)).toEqual(['tint', 'tint', undefined])
  })

  it('writes just this one when set apart', () => {
    const design = home(block('ideas', 'aaaaaaaa'), block('status', 'bbbbbbbb'))
    writeLook(design, 'one', 'aaaaaaaa', 'align', 'centre')
    expect(design.pages.home.blocks.map((b) => b.look?.align)).toEqual(['centre', undefined])
  })

  it('clears a value without leaving an empty look behind', () => {
    const design = home(block('ideas', 'aaaaaaaa', { tone: 'plain' }))
    writeLook(design, 'one', 'aaaaaaaa', 'tone', undefined)
    expect(design.pages.home.blocks[0]!.look).toBeUndefined()
  })

  it('keeps a block’s element looks when its tone is cleared', () => {
    const design = home(
      block('ideas', 'aaaaaaaa', { tone: 'plain', style: { card: { base: { radius: 4 } } } })
    )
    writeLook(design, 'every', 'aaaaaaaa', 'tone', undefined)
    expect(design.pages.home.blocks[0]!.look).toEqual({ style: { card: { base: { radius: 4 } } } })
  })

  it('reads the shared value from what most of the other blocks hold', () => {
    const design = home(
      block('ideas', 'aaaaaaaa', { tone: 'brand' }),
      block('status', 'bbbbbbbb', { tone: 'plain' }),
      block('contact', 'cccccccc', { tone: 'plain' }),
      block('links', 'dddddddd')
    )
    expect(sharedLook(design, 'aaaaaaaa', 'tone')).toBe('plain')
    expect(sharedLook(design, 'aaaaaaaa', 'align')).toBeUndefined()
  })

  it('reads nothing shared for a block alone on Home', () => {
    expect(sharedLook(home(block('ideas', 'aaaaaaaa', { tone: 'tint' })), 'aaaaaaaa', 'tone')).toBe(
      undefined
    )
  })

  it('puts a block set apart back to the shared value', () => {
    const design = home(
      block('ideas', 'aaaaaaaa', { tone: 'brand' }),
      block('status', 'bbbbbbbb', { tone: 'plain' })
    )
    resetLook(design, 'one', 'aaaaaaaa', 'tone')
    expect(design.pages.home.blocks[0]!.look?.tone).toBe('plain')
    resetLook(design, 'every', 'aaaaaaaa', 'tone')
    expect(design.pages.home.blocks.map((b) => b.look?.tone)).toEqual([undefined, undefined])
  })

  it('lists the blocks whose look differs from this one, with what differs', () => {
    const design = home(
      block('ideas', 'aaaaaaaa', { tone: 'tint' }),
      block('status', 'bbbbbbbb', { tone: 'tint' }),
      block('contact', 'cccccccc', { tone: 'plain', align: 'centre' }),
      block('composer', 'dddddddd', { tone: 'brand' })
    )
    expect(lookOutliers(design, 'aaaaaaaa')).toEqual([{ id: 'cccccccc', props: ['tone', 'align'] }])
  })

  it('treats a value left out as its usual one when comparing', () => {
    const design = home(
      block('ideas', 'aaaaaaaa'),
      block('status', 'bbbbbbbb', { tone: 'card', align: 'start' })
    )
    expect(lookOutliers(design, 'aaaaaaaa')).toEqual([])
    expect(LOOK_DEFAULTS.tone).toBe('card')
  })

  it('brings another block into line with this one', () => {
    const design = home(
      block('ideas', 'aaaaaaaa', { tone: 'tint', colour: 'support' }),
      block('status', 'bbbbbbbb', { tone: 'plain', align: 'centre' })
    )
    matchLook(design, 'bbbbbbbb', 'aaaaaaaa')
    expect(design.pages.home.blocks[1]!.look).toEqual({ tone: 'tint', colour: 'support' })
  })
})
