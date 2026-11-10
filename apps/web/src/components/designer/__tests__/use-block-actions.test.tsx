// @vitest-environment happy-dom
/** Home's blocks are added under the picked one and moved by place, each move said aloud. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { newBlock } from '@/lib/shared/design/home'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { Selection } from '@/lib/shared/design/outline'
import { movedSaid, useBlockActions } from '../use-block-actions'

function setup(selection: Selection | null = null) {
  const design = defaultDesign()
  design.nav.home.on = true
  // One under another: Welcome, Top posts, then the roadmap.
  design.pages.home.blocks = (['welcome', 'ideas', 'roadmap'] as const).map((type, i) => ({
    ...newBlock(type, { y: [0, 3, 11][i] }),
    id: `b${i}`,
  }))
  const draft = {
    design,
    update: vi.fn((change: (next: PortalDesign) => void) => change(draft.design)),
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
    })
  )
  const order = () => draft.design.pages.home.blocks.map((block) => block.id)
  return { result, order, say, setSelection, draft: () => draft }
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
