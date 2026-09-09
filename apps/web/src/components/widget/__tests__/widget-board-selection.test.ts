import { describe, it, expect } from 'vitest'
import { reconcileBoardSelection, resolveDefaultBoardId } from '../widget-board-selection'

const ideas = { id: 'board_1', slug: 'ideas' }
const bugs = { id: 'board_2', slug: 'bugs' }

describe('resolveDefaultBoardId', () => {
  it('prefers the configured default board when it is visible', () => {
    expect(resolveDefaultBoardId([ideas, bugs], 'bugs')).toBe('board_2')
  })

  it('auto-selects a single board', () => {
    expect(resolveDefaultBoardId([ideas], undefined)).toBe('board_1')
    expect(resolveDefaultBoardId([ideas], 'not-visible')).toBe('board_1')
  })

  it('leaves the choice open for several boards without a default', () => {
    expect(resolveDefaultBoardId([ideas, bugs], undefined)).toBe('')
  })

  it('has nothing to select from an empty list', () => {
    // The anonymous SSR seed on a private portal — the composer must not
    // point at a board that is not there.
    expect(resolveDefaultBoardId([], 'ideas')).toBe('')
  })
})

describe('reconcileBoardSelection', () => {
  it('keeps a selection that is still in the list', () => {
    expect(reconcileBoardSelection('board_2', [ideas, bugs], 'ideas')).toBe('board_2')
  })

  it('re-derives an empty selection once boards arrive', () => {
    // Mount on the empty SSR seed, then the post-identify refetch lands.
    expect(reconcileBoardSelection('', [], 'ideas')).toBe('')
    expect(reconcileBoardSelection('', [ideas], 'ideas')).toBe('board_1')
  })

  it('drops a selection that is no longer visible', () => {
    expect(reconcileBoardSelection('board_9', [ideas], undefined)).toBe('board_1')
    expect(reconcileBoardSelection('board_9', [ideas, bugs], undefined)).toBe('')
  })
})
