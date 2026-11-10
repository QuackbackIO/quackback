// @vitest-environment happy-dom
/**
 * What the canvas says about a picked element is read once a moment after
 * the pick or a change, and not again while nothing changes: the builder
 * hands the pick over afresh on each render, and reading on each render
 * rendered the builder again, over and over, while an element was picked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { defaultDesign } from '@/lib/shared/design/schema'
import type { ElementPick } from '@/lib/shared/design/element-pick'

const reads = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/shared/design/element-pick', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shared/design/element-pick')>()
  return {
    ...actual,
    // A fresh answer each read, as reading the canvas gives.
    reachOf: () => {
      reads.count++
      return { count: 1, block: null }
    },
    locatePick: (doc: Document) => doc.body,
    drawnValues: () => ({ fontSize: 16 }),
  }
})

const { usePickReach } = await import('../use-pick-reach')

const design = defaultDesign()
const headline = (): ElementPick => ({ section: 'hero', element: 'headline', part: null, index: 0 })

describe('usePickReach', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    reads.count = 0
    const frame = document.createElement('iframe')
    frame.setAttribute('data-designer-canvas', '')
    document.body.append(frame)
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('reads the canvas once for a pick handed over afresh on every render', () => {
    let renders = 0
    const hook = renderHook(() => {
      renders++
      // A new object naming the same element each render, as the builder's shell passes it.
      return usePickReach(headline(), design, 'home')
    })
    act(() => vi.advanceTimersByTime(2000))
    expect(hook.result.current.drawn).toEqual({ fontSize: 16 })
    expect(reads.count).toBe(1)
    expect(renders).toBeLessThanOrEqual(3)
  })

  it('reads again when another element is picked, or the design changes', () => {
    const hook = renderHook(({ pick, at }) => usePickReach(pick, at, 'home'), {
      initialProps: { pick: headline(), at: design },
    })
    act(() => vi.advanceTimersByTime(200))
    expect(reads.count).toBe(1)
    hook.rerender({ pick: { ...headline(), element: 'subtitle' } as ElementPick, at: design })
    act(() => vi.advanceTimersByTime(200))
    expect(reads.count).toBe(2)
    hook.rerender({
      pick: { ...headline(), element: 'subtitle' } as ElementPick,
      at: defaultDesign(),
    })
    act(() => vi.advanceTimersByTime(200))
    expect(reads.count).toBe(3)
  })

  it('keeps what it read when a read after a change reads the same', () => {
    const hook = renderHook(({ at }) => usePickReach(headline(), at, 'home'), {
      initialProps: { at: design },
    })
    act(() => vi.advanceTimersByTime(200))
    const { reach } = hook.result.current
    hook.rerender({ at: defaultDesign() })
    act(() => vi.advanceTimersByTime(200))
    expect(reads.count).toBe(2)
    expect(hook.result.current.reach).toBe(reach)
  })
})
