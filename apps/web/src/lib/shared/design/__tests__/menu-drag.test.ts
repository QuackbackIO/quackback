/**
 * Dragging a menu item: the gap the pointer is over, read from the items'
 * boxes, where the insertion bar goes, the place among every part that can
 * move (hidden ones keep theirs), and the one step a drop makes.
 */
import { describe, expect, it } from 'vitest'
import { menuParts } from '../menu'
import { menuDropBar, menuDropGap, menuDropPlace, menuPlaceStep, menuStep } from '../menu-actions'
import type { PortalPageGates } from '../paths'
import { defaultDesign, type PortalDesign } from '../schema'

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

// Four items, 80 wide with 10 between: 0-80, 90-170, 180-260, 270-350.
const boxes = [0, 90, 180, 270].map((left) => ({ left, width: 80 }))

const labels = (design: PortalDesign) => menuParts(design, gates).map((part) => part.label)

describe('the gap a dragged menu item is over', () => {
  it('is before an item while the pointer is left of its middle', () => {
    expect(menuDropGap(boxes, -20)).toBe(0)
    expect(menuDropGap(boxes, 39)).toBe(0)
    expect(menuDropGap(boxes, 41)).toBe(1)
    expect(menuDropGap(boxes, 200)).toBe(2)
    expect(menuDropGap(boxes, 300)).toBe(3)
  })

  it('is after the last item past its middle', () => {
    expect(menuDropGap(boxes, 330)).toBe(4)
    expect(menuDropGap(boxes, 900)).toBe(4)
  })

  it('is the first gap with no items', () => {
    expect(menuDropGap([], 50)).toBe(0)
  })
})

describe('where the insertion bar is drawn', () => {
  it('sits halfway between two items, and at the outer edge at either end', () => {
    expect(menuDropBar(boxes, 0)).toBe(0)
    expect(menuDropBar(boxes, 1)).toBe(85)
    expect(menuDropBar(boxes, 4)).toBe(350)
  })
})

describe('the place a drop puts an item', () => {
  const movable = ['feedback', 'roadmap', 'changelog', 'help'] as const

  it('counts places with the item taken out, as moving reads them', () => {
    expect(menuDropPlace(movable, movable, 'roadmap', 4)).toBe(3)
    expect(menuDropPlace(movable, movable, 'help', 0)).toBe(0)
    expect(menuDropPlace(movable, movable, 'feedback', 3)).toBe(2)
  })

  it('is no move in the gaps either side of the item itself', () => {
    expect(menuDropPlace(movable, movable, 'roadmap', 1)).toBeNull()
    expect(menuDropPlace(movable, movable, 'roadmap', 2)).toBeNull()
  })

  it('skips a hidden part the menu does not draw, which keeps its place', () => {
    const drawn = ['feedback', 'changelog', 'help'] as const
    // Dropped before Help: after Roadmap (hidden) and Changelog.
    expect(menuDropPlace(movable, drawn, 'feedback', 2)).toBe(2)
    // Dropped at the end.
    expect(menuDropPlace(movable, drawn, 'feedback', 3)).toBe(3)
  })
})

describe('a drop as one step', () => {
  it('moves the item, named for undo, and says where it went', () => {
    const start = defaultDesign()
    const step = menuPlaceStep(start, gates, 'roadmap', 3)!
    expect(step.label).toBe('Move Roadmap in the menu')
    expect(step.said).toBe('Roadmap moved to place 4 of 4 in the menu.')
    const after = structuredClone(start)
    step.change(after)
    expect(labels(after)).toEqual(['Feedback', 'Changelog', 'Help Center', 'Roadmap'])
  })

  it('is no step where the item already is, or for Home', () => {
    const start = defaultDesign()
    expect(menuPlaceStep(start, gates, 'roadmap', 1)).toBeNull()
    start.nav.home = { on: true, tab: true }
    expect(menuPlaceStep(start, gates, 'home', 2)).toBeNull()
  })

  it('says where Move left and Move right put an item too', () => {
    expect(menuStep(defaultDesign(), gates, 'feedback', 'right')!.said).toBe(
      'Feedback moved to place 2 of 4 in the menu.'
    )
  })
})
