// @vitest-environment happy-dom
/**
 * A menu row wider than the screen fades at each edge with more of the menu
 * beyond it, so a visitor on a phone can see there is more.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NavScroller } from '../nav-scroller'

function sized(
  row: HTMLElement,
  { width, content, left }: { width: number; content: number; left: number }
) {
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: content })
  row.scrollLeft = left
}

afterEach(cleanup)

describe('a menu row', () => {
  it('marks the edges with more of the menu beyond them', () => {
    const { container } = render(
      <NavScroller>
        <a href="/">Home</a>
      </NavScroller>
    )
    const row = container.querySelector<HTMLElement>('[data-qb-nav-row]')!
    sized(row, { width: 390, content: 700, left: 0 })
    act(() => void row.dispatchEvent(new Event('scroll')))
    expect(row.hasAttribute('data-more-end')).toBe(true)
    expect(row.hasAttribute('data-more-start')).toBe(false)

    sized(row, { width: 390, content: 700, left: 310 })
    act(() => void row.dispatchEvent(new Event('scroll')))
    expect(row.hasAttribute('data-more-end')).toBe(false)
    expect(row.hasAttribute('data-more-start')).toBe(true)
  })

  it('marks nothing when the menu fits', () => {
    const { container } = render(
      <NavScroller>
        <a href="/">Home</a>
      </NavScroller>
    )
    const row = container.querySelector<HTMLElement>('[data-qb-nav-row]')!
    sized(row, { width: 1200, content: 600, left: 0 })
    act(() => void row.dispatchEvent(new Event('scroll')))
    expect(row.hasAttribute('data-more-end')).toBe(false)
    expect(row.hasAttribute('data-more-start')).toBe(false)
  })

  it('shows a way on at the edge with more beyond it, which scrolls the menu along', () => {
    const { container } = render(
      <NavScroller>
        <a href="/">Home</a>
      </NavScroller>
    )
    const row = container.querySelector<HTMLElement>('[data-qb-nav-row]')!
    const more = container.querySelector<HTMLElement>('[data-qb-nav-more]')!
    // Shown only beside a row marked as having more at its end.
    expect(row.nextElementSibling).toBe(more)
    expect(more.className).toContain('[[data-more-end]+&]:flex')
    // A pointer convenience: the menu's links are reachable by keyboard already.
    expect(more.getAttribute('aria-hidden')).toBe('true')
    expect(more.tabIndex).toBe(-1)
    sized(row, { width: 390, content: 700, left: 0 })
    let by = 0
    row.scrollBy = ((options: ScrollToOptions) => void (by = options.left ?? 0)) as never
    fireEvent.click(more)
    expect(by).toBeGreaterThan(0)
  })
})
