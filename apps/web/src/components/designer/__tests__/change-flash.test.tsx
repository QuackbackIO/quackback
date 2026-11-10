// @vitest-environment happy-dom
/**
 * The canvas outlines what changed in neutral grey: the part a change is in,
 * and the elements a style changed, each forced into the state it changed
 * while outlined. Never in the brand's colour; still, not fading, for those
 * who ask for less motion.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { CanvasLayer } from '../canvas-layer'
import { EditingLayer } from '../editing-layer'
import { FLASH_MS, useChangeFlash } from '../use-change-flash'

afterEach(() => {
  cleanup()
  document.querySelector('[data-test-page]')?.remove()
  vi.useRealTimers()
})

/** The page the frame draws, in this document: a hero holding two main buttons. */
function page() {
  const root = document.createElement('div')
  root.setAttribute('data-test-page', '')
  const hero = document.createElement('section')
  hero.setAttribute('data-qb-section', 'hero')
  hero.getBoundingClientRect = () => new DOMRect(0, 60, 1000, 300)
  hero.getClientRects = () => [hero.getBoundingClientRect()] as unknown as DOMRectList
  for (const x of [100, 300]) {
    const button = document.createElement('button')
    button.setAttribute('data-slot', 'button')
    button.setAttribute('data-variant', 'default')
    button.getBoundingClientRect = () => new DOMRect(x, 200, 120, 40)
    button.getClientRects = () => [button.getBoundingClientRect()] as unknown as DOMRectList
    hero.append(button)
  }
  root.append(hero)
  document.body.append(root)
  return {
    contentDocument: document,
    contentWindow: window,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLIFrameElement
}

function layer(flash: Parameters<typeof CanvasLayer>[0]['flash']) {
  return render(
    <CanvasLayer
      canvas={{ frame: page(), scale: 1, room: { width: 1200, height: 800 } }}
      hovered={null}
      picked={null}
      name={null}
      homeOn
      pages={['home']}
      onPage={vi.fn()}
      onDuplicate={vi.fn()}
      onRemove={vi.fn()}
      onDeselect={vi.fn()}
      flash={flash}
    />
  )
}

describe('the canvas’s outline of a change', () => {
  it('outlines the part a change is in, in neutral grey', async () => {
    const { container } = layer({ spots: [{ page: null, section: 'hero' }], seq: 1 })
    await waitFor(() => expect(container.querySelectorAll('[data-change-outline]')).toHaveLength(1))
    const outline = container.querySelector<HTMLElement>('[data-change-outline]')!
    expect(outline.style.outline).toContain('#71717a')
    expect(outline.getAttribute('aria-hidden')).toBe('true')
  })

  it('outlines each element a style changed, forced into the state it changed', async () => {
    const { container, unmount } = layer({
      spots: [{ page: null, element: 'button', state: 'hover' }],
      seq: 1,
    })
    await waitFor(() => expect(container.querySelectorAll('[data-change-outline]')).toHaveLength(2))
    const buttons = [...document.querySelectorAll('[data-test-page] button')]
    expect(buttons.map((button) => button.getAttribute('data-qb-force'))).toEqual([
      'hover',
      'hover',
    ])
    unmount()
    expect(buttons.map((button) => button.getAttribute('data-qb-force'))).toEqual([null, null])
  })

  it('outlines nothing for a part this page does not draw', async () => {
    const { container } = layer({ spots: [{ page: 'roadmap', section: 'board' }], seq: 1 })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(container.querySelectorAll('[data-change-outline]')).toHaveLength(0)
  })
})

describe('the outline itself', () => {
  const room = { width: 800, height: 600 }
  const rect = { left: 10, top: 10, width: 100, height: 50 }

  it('fades after it shows, unless less motion is asked for', async () => {
    const { container } = render(
      <EditingLayer
        room={room}
        hovered={null}
        picked={null}
        name={null}
        onSettings={vi.fn()}
        changed={{ rects: [rect], seq: 1 }}
      />
    )
    const outline = container.querySelector<HTMLElement>('[data-change-outline]')!
    expect(outline.className).toContain('motion-reduce:transition-none')
    await waitFor(() => expect(outline.className).toContain('motion-safe:opacity-0'))
    // Never brand coloured: grey, edged in white so it reads on any brand colour.
    expect(outline.style.outline).toContain('#71717a')
    expect(outline.style.outline).not.toContain('#2563eb')
  })
})

describe('useChangeFlash', () => {
  it('shows spots for a moment, a newer one in its place', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useChangeFlash())
    act(() => result.current.show([{ page: null, section: 'hero' }]))
    expect(result.current.flash).toEqual({ spots: [{ page: null, section: 'hero' }], seq: 1 })
    act(() => vi.advanceTimersByTime(FLASH_MS - 100))
    act(() => result.current.show([{ page: null, section: 'header' }]))
    expect(result.current.flash?.seq).toBe(2)
    act(() => vi.advanceTimersByTime(FLASH_MS - 100))
    expect(result.current.flash?.spots).toEqual([{ page: null, section: 'header' }])
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.flash).toBeNull()
  })

  it('shows nothing for no spots', () => {
    const { result } = renderHook(() => useChangeFlash())
    act(() => result.current.show([]))
    expect(result.current.flash).toBeNull()
  })
})
