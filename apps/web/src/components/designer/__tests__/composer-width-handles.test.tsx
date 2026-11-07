// @vitest-environment happy-dom
/**
 * The handles on the hero's composer: one on its right edge, and one on its
 * left as well when the words are centred, each starting a resize; while
 * dragging, the width it snaps to and the composer as the pointer holds it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ComposerWidthHandles } from '../composer-width-handles'

afterEach(cleanup)

const box = { left: 100, top: 200, width: 400, height: 60 }

describe('ComposerWidthHandles', () => {
  it('puts a handle on the right edge, with the grid blocks’ look and cursor', () => {
    const onStart = vi.fn()
    const { container } = render(
      <ComposerWidthHandles box={box} centred={false} view={null} onStart={onStart} />
    )
    const handles = [...container.querySelectorAll<HTMLElement>('[data-resize-handle]')]
    expect(handles.map((handle) => handle.dataset.resizeHandle)).toEqual(['right'])
    const right = handles[0]!
    expect(right.style.left).toBe('496px')
    expect(right.style.top).toBe('218px')
    expect(right.style.cursor).toBe('ew-resize')
    expect(right.className).toContain('rounded-full')
    fireEvent.pointerDown(right, { button: 0 })
    expect(onStart).toHaveBeenCalledWith('right', expect.anything())
    // No height handle: the composer grows with what is typed.
    expect(container.querySelector('[data-resize-handle="bottom"]')).toBeNull()
    expect(container.querySelector('[data-composer-ghost]')).toBeNull()
  })

  it('adds a left handle when centred, as it grows on both sides', () => {
    const onStart = vi.fn()
    const { container } = render(
      <ComposerWidthHandles box={box} centred view={null} onStart={onStart} />
    )
    const left = container.querySelector<HTMLElement>('[data-resize-handle="left"]')!
    expect(left.style.left).toBe('96px')
    fireEvent.pointerDown(left, { button: 0 })
    expect(onStart).toHaveBeenCalledWith('left', expect.anything())
  })

  it('draws the width it snaps to and the composer as held, the handles riding on it', () => {
    const { container } = render(
      <ComposerWidthHandles
        box={box}
        centred={false}
        view={{
          edge: 'right',
          lifted: { left: 100, top: 200, width: 330, height: 60 },
          ghost: { left: 100, top: 200, width: 384, height: 60 },
        }}
        onStart={vi.fn()}
      />
    )
    expect(container.querySelector<HTMLElement>('[data-composer-ghost]')!.style.width).toBe('384px')
    expect(container.querySelector<HTMLElement>('[data-composer-lifted]')!.style.width).toBe(
      '330px'
    )
    expect(container.querySelector<HTMLElement>('[data-resize-handle="right"]')!.style.left).toBe(
      '426px'
    )
  })
})
