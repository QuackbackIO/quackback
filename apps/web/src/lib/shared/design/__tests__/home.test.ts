/**
 * Home's starter layout: Welcome, then Share an idea with Status, Top ideas
 * with Latest updates, the roadmap and help topics, skipping any whose page
 * is off. Every block it makes is valid at its width.
 */
import { describe, expect, it } from 'vitest'
import { newBlock, starterHomeBlocks } from '../home'
import { filledSpans } from '../home-spans'
import { portalDesign, defaultDesign } from '../schema'
import { DESIGN_OPTIONS } from '../options'

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

describe('starterHomeBlocks', () => {
  it('lays out every page the workspace has', () => {
    expect(starterHomeBlocks(ALL_ON).map((block) => [block.type, block.width])).toEqual([
      ['welcome', 'full'],
      ['composer', 'two_thirds'],
      ['status', 'third'],
      ['ideas', 'half'],
      ['updates', 'half'],
      ['roadmap', 'full'],
      ['help_topics', 'full'],
    ])
  })

  it('skips the blocks whose pages are off', () => {
    const types = starterHomeBlocks({
      ...ALL_ON,
      status: false,
      changelog: false,
      help: false,
    }).map((block) => block.type)
    expect(types).toEqual(['welcome', 'composer', 'ideas', 'roadmap'])
  })

  it('makes a valid design', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = starterHomeBlocks(ALL_ON)
    expect(portalDesign.safeParse(doc).success).toBe(true)
  })
})

describe('newBlock', () => {
  it('makes every block type valid at its first allowed width', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = DESIGN_OPTIONS.blockType.map((type) => newBlock(type))
    expect(portalDesign.safeParse(doc).success).toBe(true)
  })
})

describe('filledSpans', () => {
  it('grows a block to its row’s end when the next will not fit, and the last block too', () => {
    // A two-thirds composer whose status block's page is off, then a third on its own.
    expect(filledSpans(['full', 'two_thirds', 'half', 'half', 'third'], 'wide')).toEqual([
      6, 6, 3, 3, 6,
    ])
    expect(filledSpans(['two_thirds', 'third', 'half', 'half'], 'wide')).toEqual([4, 2, 3, 3])
    expect(filledSpans(['third', 'two_thirds', 'third'], 'medium')).toEqual([2, 2, 2])
    expect(filledSpans(['third', 'third', 'half'], 'medium')).toEqual([1, 1, 2])
    expect(filledSpans([], 'wide')).toEqual([])
  })
})
