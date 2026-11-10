/**
 * The Add sheet: the blocks Home can take, grouped by job, each saying when
 * Home already has it; and where a click puts the new block.
 */
import { describe, expect, it } from 'vitest'
import { addSheetGroups } from '../add-sheet'
import { newBlock, HOME_BLOCKS_MAX, type HomeBlock } from '../home'
import type { PortalPageGates } from '../paths'
import { defaultDesign, type PortalDesign } from '../schema'

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  status: true,
  support: true,
}

function withBlocks(blocks: HomeBlock[]): PortalDesign {
  const design = defaultDesign()
  design.pages.home.blocks = blocks
  return design
}

describe('addSheetGroups', () => {
  it('groups the blocks by job, in the registry’s order', () => {
    const groups = addSheetGroups(withBlocks([]), ALL_ON)
    expect(groups.map((group) => group.name)).toEqual([
      'Help people find answers',
      'Hear from customers',
      'Show progress',
      'Your own',
    ])
    expect(groups[0]!.rows.map((row) => row.type)).toEqual(['help_search', 'help_topics', 'status'])
  })

  it('shows a block whose page is off greyed, with the page it needs', () => {
    const groups = addSheetGroups(withBlocks([]), {
      ...ALL_ON,
      help: false,
      status: false,
    })
    const answers = groups.find((group) => group.job === 'answers')!
    expect(answers.rows.map((row) => [row.type, row.needs, row.disabled])).toEqual([
      ['help_search', 'help', true],
      ['help_topics', 'help', true],
      ['status', 'status', true],
    ])
    // A block whose page is on, or that needs no page, can still be added.
    const rows = groups.flatMap((group) => group.rows)
    expect(rows.find((row) => row.type === 'ideas')).toMatchObject({ needs: null, disabled: false })
    expect(rows.find((row) => row.type === 'links')).toMatchObject({ needs: null, disabled: false })
  })

  it('says which are on Home already, and a block Home holds once cannot be added again', () => {
    const groups = addSheetGroups(withBlocks([newBlock('ideas'), newBlock('status')]), ALL_ON)
    const rows = groups.flatMap((group) => group.rows)
    const ideas = rows.find((row) => row.type === 'ideas')!
    const status = rows.find((row) => row.type === 'status')!
    const welcome = rows.find((row) => row.type === 'welcome')!
    expect(ideas).toMatchObject({ onHome: true, disabled: false })
    expect(status).toMatchObject({ onHome: true, disabled: true })
    expect(welcome).toMatchObject({ onHome: false, disabled: false })
  })

  it('offers nothing once Home is full', () => {
    const full = withBlocks(Array.from({ length: HOME_BLOCKS_MAX }, () => newBlock('links')))
    const rows = addSheetGroups(full, ALL_ON).flatMap((group) => group.rows)
    expect(rows.every((row) => row.disabled)).toBe(true)
  })
})
