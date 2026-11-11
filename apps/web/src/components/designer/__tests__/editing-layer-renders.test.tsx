// @vitest-environment happy-dom
/**
 * The picked block's chip follows the block as it moves without being drawn
 * again: only where it sits changes. A change to what it offers draws it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'

let tips = 0
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => {
    tips++
    return children
  },
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}))

const { EditingLayer } = await import('../editing-layer')

afterEach(() => {
  cleanup()
  tips = 0
})

const room = { width: 800, height: 600 }
const handlers = { onSettings: vi.fn(), onRemove: vi.fn(), onDuplicate: vi.fn() }

const layer = (top: number, name = 'Top posts') => (
  <EditingLayer
    room={room}
    hovered={null}
    picked={{ left: 40, top, width: 400, height: 200 }}
    pickedKey="block-a"
    name={name}
    {...handlers}
  />
)

describe('the picked block’s chip', () => {
  it('moves with its block without being drawn again', () => {
    const { rerender, container } = render(layer(120))
    const drawn = tips
    expect(drawn).toBeGreaterThan(0)
    rerender(layer(160))
    expect(tips).toBe(drawn)
    const place = container.querySelector<HTMLElement>('[data-chip-place]')!
    expect(Number.parseFloat(place.style.top)).toBeLessThan(160)
    rerender(layer(160, 'Latest updates'))
    expect(tips).toBeGreaterThan(drawn)
  })
})
