/**
 * Home's blocks that draw nothing with the workspace's data, which Home lays
 * out without: Welcome without words, a roadmap block with no roadmap or no
 * columns, Latest updates with no entries, Help topics with no topics.
 */
import { describe, expect, it } from 'vitest'
import { newBlock, type HomeBlock } from '@/lib/shared/design/home'
import { emptyBlocks } from '../home-empty'
import { homeLayout } from '../home-blocks'
import { defaultDesign } from '@/lib/shared/design/schema'

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const blocks: HomeBlock[] = [
  { ...newBlock('welcome'), body: { type: 'doc', content: [{ type: 'paragraph' }] } } as HomeBlock,
  newBlock('roadmap', { y: 1 }),
  newBlock('updates', { y: 2 }),
  newBlock('help_topics', { y: 3 }),
  newBlock('status', { y: 4 }),
]

describe('emptyBlocks', () => {
  it('finds the blocks with nothing to draw', () => {
    const empty = emptyBlocks(blocks, {
      roadmaps: [{ id: 'roadmap_1', columns: [{ statusId: null }] }],
      entries: 0,
      categories: [{ id: 'kb_category_1', parentId: 'kb_category_0' }],
    })
    expect([...empty]).toEqual([0, 1, 2, 3])
  })

  it('keeps an empty Welcome in the builder, which draws a place to write it', () => {
    expect([...emptyBlocks(blocks.slice(0, 1), {}, { samples: true })]).toEqual([])
    expect([...emptyBlocks(blocks.slice(0, 1), {})]).toEqual([0])
  })

  it('keeps a block whose data is in and has something, or is not in yet', () => {
    const empty = emptyBlocks(blocks.slice(1), {
      roadmaps: [{ id: 'roadmap_1', columns: [{ statusId: 'status_1' }] }],
      entries: 2,
    })
    expect([...empty]).toEqual([])
  })

  it('leaves out a status block whose page has no components, rather than claim all is well', () => {
    const status = [newBlock('status')]
    expect([...emptyBlocks(status, { statusComponents: 0 })]).toEqual([0])
    expect([...emptyBlocks(status, { statusComponents: 2 })]).toEqual([])
    expect([...emptyBlocks(status, {})]).toEqual([])
  })

  it('leaves out help topics when only sub-topics are picked', () => {
    const topics = [{ ...newBlock('help_topics'), categoryIds: ['kb_category_sub'] } as HomeBlock]
    const categories = [
      { id: 'kb_category_top', parentId: null },
      { id: 'kb_category_sub', parentId: 'kb_category_top' },
    ]
    expect([...emptyBlocks(topics, { categories })]).toEqual([0])
  })

  it('leaves out a roadmap whose picked columns are gone', () => {
    const roadmap = [{ ...newBlock('roadmap'), statusIds: ['post_status_gone'] } as HomeBlock]
    const roadmaps = [{ id: 'roadmap_1', columns: [{ statusId: 'post_status_a' }] }]
    expect([...emptyBlocks(roadmap, { roadmaps })]).toEqual([0])
  })

  it('keeps an empty block that says its message, and hides Top posts told to', () => {
    const saying = [
      { ...newBlock('updates'), whenEmpty: 'message' } as HomeBlock,
      { ...newBlock('status'), whenEmpty: 'message' } as HomeBlock,
      newBlock('ideas'),
      { ...newBlock('ideas'), whenEmpty: 'hide' } as HomeBlock,
    ]
    const ideas = new Map([
      [2, 0],
      [3, 0],
    ])
    expect([...emptyBlocks(saying, { entries: 0, statusComponents: 0, ideas })]).toEqual([3])
  })

  it('leaves no block out in the builder, which draws samples in them and a place to write a Welcome', () => {
    const empty = emptyBlocks(
      blocks,
      {
        roadmaps: [],
        entries: 0,
        categories: [],
        statusComponents: 0,
      },
      { samples: true }
    )
    expect([...empty]).toEqual([])
  })

  it('lays Home out without them, the rest closing up', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = blocks
    const { order, areas } = homeLayout(doc.pages.home, ALL_ON, new Set([0, 1, 2, 3]))
    expect(order).toEqual([4])
    expect(areas.get(4)).toMatchObject({ '--qb-area-lg': '1 / 1 / span 1 / span 4' })
  })
})
