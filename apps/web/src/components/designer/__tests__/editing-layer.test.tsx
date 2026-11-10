// @vitest-environment happy-dom
/**
 * The editing layer over the canvas: a quiet outline under the pointer, and
 * the picked block's outline and chip: its grip, its name and Remove, with
 * Duplicate on its right-click menu. Open is never on the block's chip.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { EditingLayer, useGlide } from '../editing-layer'
import { openChipMenu } from '../settings-focus'

afterEach(cleanup)

const room = { width: 800, height: 600 }
const block = { left: 40, top: 120, width: 400, height: 200 }

function show(props: Partial<Parameters<typeof EditingLayer>[0]> = {}) {
  const handlers = {
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
    onSettings: vi.fn(),
  }
  const view = render(
    <EditingLayer
      room={room}
      hovered={null}
      picked={block}
      name="Top posts"
      {...handlers}
      {...props}
    />
  )
  return { ...view, ...handlers }
}

describe('EditingLayer', () => {
  it('draws only a quiet outline under the pointer when nothing is picked', () => {
    const { container } = show({ picked: null, name: null, hovered: block })
    expect(container.querySelector('[data-hover-outline]')).not.toBeNull()
    expect(container.querySelector('[data-picked-outline]')).toBeNull()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('puts the picked block’s chip on its top edge, named for it', () => {
    const { container } = show()
    expect(container.querySelector('[data-picked-outline]')).not.toBeNull()
    const chip = screen.getByRole('toolbar', { name: 'Top posts, picked' })
    expect(chip.hasAttribute('data-chip-inside')).toBe(false)
    expect(screen.getByRole('button', { name: 'Top posts: settings' }).textContent).toContain(
      'Top posts'
    )
  })

  it('moves the chip inside a block at the top of the canvas', () => {
    show({ picked: { ...block, top: 4 } })
    expect(screen.getByRole('toolbar').hasAttribute('data-chip-inside')).toBe(true)
  })

  it('removes the block and leads to its settings, with no Open or Duplicate on the chip', () => {
    const { onRemove, onSettings } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Top posts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Top posts: settings' }))
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onSettings).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /Open/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Duplicate/ })).toBeNull()
  })

  it('copies the block from the chip’s right-click menu, as Ctrl+D does', async () => {
    const { onDuplicate } = show()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Top posts: settings' }))
    const item = await screen.findByRole('menuitem', { name: /Duplicate/ })
    expect(item.textContent).toContain('Ctrl+D')
    fireEvent.click(item)
    expect(onDuplicate).toHaveBeenCalledOnce()
  })

  it('offers the block’s ⋯ actions on its right-click menu', async () => {
    const up = vi.fn()
    const { onRemove } = show({ onMove: { up, down: null } })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Top posts: settings' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'DuplicateCtrl+D',
      'Move up',
      'Move down',
      'RemoveDelete',
    ])
    // The last block goes no further down.
    expect(items[2]!.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(items[1]!)
    expect(up).toHaveBeenCalledOnce()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Top posts: settings' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('opens the actions of the block right-clicked on the page, once its chip is drawn', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
    try {
      const { rerender } = show({ picked: null, name: null, pickedKey: null })
      openChipMenu('block-b1', { x: 300, y: 200 })
      vi.advanceTimersByTime(17)
      expect(screen.queryByRole('menu')).toBeNull()
      // Picked on the next frame, as the right-click picks it.
      rerender(
        <EditingLayer
          room={room}
          hovered={null}
          picked={block}
          pickedKey="block-b1"
          name="Top posts"
          onDuplicate={vi.fn()}
          onRemove={vi.fn()}
          onSettings={vi.fn()}
        />
      )
      act(() => void vi.advanceTimersByTime(17))
    } finally {
      vi.useRealTimers()
    }
    expect(await screen.findByRole('menu', { name: 'Top posts: more' })).toBeTruthy()
  })

  it('offers no copy or removal for a part of the page that cannot be', () => {
    show({ name: 'Header', onDuplicate: undefined, onRemove: undefined })
    expect(screen.queryByRole('button', { name: /Duplicate|Remove/ })).toBeNull()
  })

  it('shows no chip for a picked block scrolled out of view', () => {
    show({ picked: { ...block, top: -400 } })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('gives a block on Home’s grid a grip that drags and takes the arrow keys', () => {
    const grip = { onPointerDown: vi.fn(), onKeyDown: vi.fn() }
    show({ grip })
    const handle = screen.getByRole('button', { name: 'Move Top posts' })
    expect(handle.hasAttribute('data-drag-handle')).toBe(true)
    expect(handle.getAttribute('aria-keyshortcuts')).toContain('Shift+ArrowRight')
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20 })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(grip.onPointerDown).toHaveBeenCalledOnce()
    expect(grip.onKeyDown).toHaveBeenCalledOnce()
  })

  it('has no grip for a block that does not move', () => {
    show()
    expect(screen.queryByRole('button', { name: 'Move Top posts' })).toBeNull()
  })
})

describe('useGlide', () => {
  it('glides for a moment when the pick moves to another block, not on the first pick', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ key }) => useGlide(key), {
      initialProps: { key: null as string | null },
    })
    rerender({ key: 'block-a' })
    expect(result.current).toBe(false)
    rerender({ key: 'block-b' })
    expect(result.current).toBe(true)
    act(() => void vi.advanceTimersByTime(250))
    expect(result.current).toBe(false)
    vi.useRealTimers()
  })

  it('moves the picked outline smoothly only while gliding', () => {
    const { container, rerender } = render(
      <EditingLayer
        room={room}
        hovered={null}
        picked={block}
        pickedKey="block-a"
        name="Top posts"
        onSettings={vi.fn()}
      />
    )
    const outline = () => container.querySelector<HTMLElement>('[data-picked-outline]')!
    expect(outline().style.transition).toBe('')
    rerender(
      <EditingLayer
        room={room}
        hovered={null}
        picked={{ ...block, top: 300 }}
        pickedKey="block-b"
        name="Status"
        onSettings={vi.fn()}
      />
    )
    expect(outline().style.transition).toContain('top')
  })
})
