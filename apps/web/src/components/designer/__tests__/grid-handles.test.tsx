// @vitest-environment happy-dom
/**
 * The picked Home block's resize handles and drag ghost: a handle on the
 * right edge, the bottom edge and the corner, each starting its own resize,
 * and while dragging, the cells the block lands on and the block as held.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { GridHandles } from '../grid-handles'

afterEach(cleanup)

const picked = { left: 40, top: 100, width: 300, height: 200 }

describe('GridHandles', () => {
  it('puts a handle on the right edge, the bottom edge and the corner', () => {
    const onStart = vi.fn()
    const { container } = render(<GridHandles picked={picked} view={null} onStart={onStart} />)
    const handles = [...container.querySelectorAll<HTMLElement>('[data-resize-handle]')]
    expect(handles.map((handle) => handle.dataset.resizeHandle)).toEqual([
      'right',
      'bottom',
      'corner',
    ])
    const right = handles[0]!
    expect(right.style.left).toBe('336px')
    expect(right.style.cursor).toBe('ew-resize')
    for (const handle of handles) fireEvent.pointerDown(handle, { button: 0 })
    expect(onStart.mock.calls.map(([edge]) => edge)).toEqual(['right', 'bottom', 'corner'])
    expect(container.querySelector('[data-grid-ghost]')).toBeNull()
  })

  it('draws the cells a dragged block lands on and the block as the pointer holds it', () => {
    const { container } = render(
      <GridHandles
        picked={picked}
        view={{
          edge: 'move',
          lifted: { left: 60, top: 300, width: 300, height: 200 },
          ghost: { left: 40, top: 320, width: 300, height: 220 },
        }}
        onStart={vi.fn()}
      />
    )
    const ghost = container.querySelector<HTMLElement>('[data-grid-ghost]')!
    expect(ghost.style.top).toBe('320px')
    expect(container.querySelector<HTMLElement>('[data-grid-lifted]')!.style.left).toBe('60px')
    // The handles ride on the held block.
    expect(container.querySelector<HTMLElement>('[data-resize-handle="bottom"]')!.style.top).toBe(
      '496px'
    )
  })
})
