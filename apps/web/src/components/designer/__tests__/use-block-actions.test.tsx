// @vitest-environment happy-dom
/** Home's blocks are added under the picked one and moved by place, each move said aloud. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createHistory, patchesBetween } from '@/lib/shared/design/history'
import { newBlock } from '@/lib/shared/design/home'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { Selection } from '@/lib/shared/design/outline'
import { movedSaid, useBlockActions } from '../use-block-actions'

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

function setup(selection: Selection | null = null, homeOn = true) {
  const design = defaultDesign()
  design.nav.home.on = homeOn
  // One under another: Welcome, Top posts, then the roadmap.
  design.pages.home.blocks = (['welcome', 'ideas', 'roadmap'] as const).map((type, i) => ({
    ...newBlock(type, { y: [0, 3, 11][i] }),
    id: `b${i}`,
  }))
  // Each update a step of a real history, made on a copy as the draft makes it.
  const history = createHistory()
  const draft = {
    design,
    update: vi.fn((recipe: (next: PortalDesign) => void, label = 'Change') => {
      const next = structuredClone(draft.design)
      recipe(next)
      const [patches, inverse] = patchesBetween(draft.design, next)
      draft.design = next
      history.getState().push(label, patches, inverse)
    }),
  }
  const say = vi.fn()
  const setSelection = vi.fn()
  const names: Record<string, string> = { 'block-b0': 'Welcome', 'block-b1': 'Top posts' }
  const { result } = renderHook(() =>
    useBlockActions({
      draft: draft as never,
      selection,
      setSelection,
      nameOf: (key) => names[key],
      say,
      gates,
    })
  )
  const order = () => draft.design.pages.home.blocks.map((block) => block.id)
  const undo = () => {
    const back = history.getState().undo(draft.design)
    if (back) draft.design = back.doc
    return back?.label ?? null
  }
  return { result, order, say, setSelection, draft: () => draft, undo }
}

describe('useBlockActions', () => {
  it('moves a block one place and says where it went', () => {
    const { result, order, say } = setup()
    act(() => result.current.moveBlock('block-b0', 1))
    expect(order()).toEqual(['b1', 'b0', 'b2'])
    expect(say).toHaveBeenCalledWith('Welcome moved to place 2 of 3.')
  })

  it('picks the block before when the last is removed, and lets go when none is left', () => {
    const { result, setSelection } = setup()
    act(() => result.current.removeBlock('block-b2'))
    expect(setSelection).toHaveBeenLastCalledWith('block-b1')
    act(() => result.current.removeBlock('block-b0'))
    act(() => result.current.removeBlock('block-b1'))
    expect(setSelection).toHaveBeenLastCalledWith(null)
  })

  it('copies a block in after it and picks the copy; removes one and picks the next', () => {
    const { result, order, say, setSelection } = setup()
    act(() => result.current.duplicateBlock('block-b1'))
    expect(order()).toHaveLength(4)
    expect(order()[1]).toBe('b1')
    expect(setSelection).toHaveBeenLastCalledWith(`block-${order()[2]}`)
    expect(say).toHaveBeenLastCalledWith('Top posts copied.')
    act(() => result.current.removeBlock('block-b0'))
    expect(order()).not.toContain('b0')
    expect(setSelection).toHaveBeenLastCalledWith('block-b1')
    expect(say).toHaveBeenLastCalledWith('Welcome removed. Undo brings it back.')
    // A section of the page is neither copied nor removed.
    act(() => result.current.removeBlock('header'))
    expect(order()).toHaveLength(3)
  })

  describe('focus after the picked block goes or is copied', () => {
    afterEach(() => {
      vi.useRealTimers()
      document.body.innerHTML = ''
    })
    /** The canvas region, and a chip drawn only from the second frame, as its box is measured then. */
    const page = () => {
      document.body.innerHTML =
        '<main data-canvas-region tabindex="-1"></main><div data-editing-layer></div>'
      const layer = document.querySelector('[data-editing-layer]')!
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          layer.innerHTML = '<button data-chip-name>Top posts</button>'
        })
      )
      ;(document.activeElement as HTMLElement | null)?.blur()
    }
    const frames = (count: number) => {
      for (let i = 0; i < count; i++) vi.advanceTimersByTime(17)
    }

    it('puts focus on the chip of the block picked next once it is drawn', () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
      const { result } = setup('block-b0')
      page()
      act(() => result.current.removeBlock('block-b0'))
      frames(5)
      expect(document.activeElement?.hasAttribute('data-chip-name')).toBe(true)
    })

    it('follows the chip as it is drawn again for the copy', () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
      const { result } = setup('block-b1')
      page()
      // The old block's chip, focused, goes a frame later as the copy is picked.
      const layer = document.querySelector('[data-editing-layer]')!
      layer.innerHTML = '<button data-chip-name>Top posts</button>'
      ;(layer.firstElementChild as HTMLElement).focus()
      act(() => result.current.duplicateBlock('block-b1'))
      frames(5)
      expect(document.activeElement?.hasAttribute('data-chip-name')).toBe(true)
      expect(document.activeElement?.isConnected).toBe(true)
    })

    it('puts focus on the chip of the copy after Ctrl+D', () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
      const { result } = setup('block-b1')
      page()
      act(() => result.current.duplicateBlock('block-b1'))
      frames(5)
      expect(document.activeElement?.hasAttribute('data-chip-name')).toBe(true)
    })

    it('puts focus on the canvas when nothing is left to pick', () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
      const { result } = setup()
      act(() => result.current.removeBlock('block-b0'))
      act(() => result.current.removeBlock('block-b1'))
      document.body.innerHTML = '<main data-canvas-region tabindex="-1"></main>'
      act(() => result.current.removeBlock('block-b2'))
      frames(3)
      expect(document.activeElement?.hasAttribute('data-canvas-region')).toBe(true)
    })
  })

  it('moves nothing past either end, and says nothing', () => {
    const { result, order, say } = setup()
    act(() => result.current.moveBlock('block-b0', -1))
    expect(order()).toEqual(['b0', 'b1', 'b2'])
    expect(say).not.toHaveBeenCalled()
  })

  it('adds a block after the picked one, and picks it', () => {
    const { result, order, setSelection, say, draft } = setup('block-b0')
    act(() => result.current.addBlock('links'))
    expect(order()[0]).toBe('b0')
    expect(order()).toHaveLength(4)
    expect(order().indexOf('b1')).toBe(2)
    expect(setSelection).toHaveBeenCalledWith(expect.stringMatching(/^block-/))
    expect(say).toHaveBeenCalledWith('Links added under Welcome.')
    expect(draft().update).toHaveBeenCalledWith(expect.any(Function), 'Add Links')
  })

  describe('a block added while Home is off', () => {
    afterEach(() => {
      vi.useRealTimers()
      document.body.innerHTML = ''
    })

    it('turns Home on in the same step, so the block is seen, and one undo takes back both', () => {
      const { result, order, say, setSelection, draft, undo } = setup('block-b1', false)
      act(() => result.current.addBlock('links'))
      expect(draft().design.nav.home.on).toBe(true)
      // Home keeps its blocks, the new one last; no starters are added.
      expect(order()).toHaveLength(4)
      expect(order().slice(0, 3)).toEqual(['b0', 'b1', 'b2'])
      expect(draft().update).toHaveBeenCalledTimes(1)
      expect(setSelection).toHaveBeenLastCalledWith(`block-${order()[3]}`)
      expect(say).toHaveBeenLastCalledWith('Home turned on. Links added. Undo takes both back.')
      expect(undo()).toBe('Add Links and turn on Home')
      expect(draft().design.nav.home.on).toBe(false)
      expect(order()).toEqual(['b0', 'b1', 'b2'])
    })

    it('adds only the block to an empty Home, never the starters', () => {
      const { result, order, draft } = setup(null, false)
      draft().design.pages.home.blocks = []
      act(() => result.current.addBlock('links'))
      expect(draft().design.nav.home.on).toBe(true)
      expect(draft().design.pages.home.blocks.map((block) => block.type)).toEqual(['links'])
      expect(order()).toHaveLength(1)
    })

    it('puts focus on the new block chip once it is drawn', () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
      const { result } = setup(null, false)
      document.body.innerHTML = '<div data-editing-layer></div>'
      const layer = document.querySelector('[data-editing-layer]')!
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          layer.innerHTML = '<button data-chip-name>Links</button>'
        })
      )
      act(() => result.current.addBlock('links'))
      for (let i = 0; i < 5; i++) vi.advanceTimersByTime(17)
      expect(document.activeElement?.hasAttribute('data-chip-name')).toBe(true)
    })
  })

  it('adds a block last when no block is picked', () => {
    const { result, order, say } = setup('header')
    act(() => result.current.addBlock('links'))
    expect(order().slice(0, 3)).toEqual(['b0', 'b1', 'b2'])
    expect(say).toHaveBeenCalledWith('Links added at the end of Home.')
  })
})

describe('movedSaid', () => {
  it('counts places from one', () => {
    expect(movedSaid('Roadmap', 2, 5)).toBe('Roadmap moved to place 3 of 5.')
  })
})
