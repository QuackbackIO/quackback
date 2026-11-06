// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FeedbackSidebar } from '../feedback-sidebar'

afterEach(cleanup)

// happy-dom lays nothing out, so the panel's sizes are set by hand.
function sizePanel(panel: HTMLElement, sizes: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: sizes.scrollHeight })
  Object.defineProperty(panel, 'clientHeight', { configurable: true, value: sizes.clientHeight })
}

describe('FeedbackSidebar', () => {
  const resizeCallbacks: ResizeObserverCallback[] = []
  const observed = new Map<Element, ResizeObserverCallback>()

  beforeEach(() => {
    resizeCallbacks.length = 0
    observed.clear()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback)
        }
        observe(target: Element) {
          observed.set(target, this.callback)
        }
        disconnect() {}
      }
    )
  })

  function renderSidebar() {
    render(
      <FeedbackSidebar>
        <div>filters</div>
      </FeedbackSidebar>
    )
    return screen.getByText('filters').parentElement!
  }

  const resize = () => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
  }

  it('fades the foot of the panel while more sits below its fold', () => {
    const panel = renderSidebar()
    sizePanel(panel, { scrollHeight: 800, clientHeight: 400 })
    resize()
    expect(panel).toHaveAttribute('data-more-below')

    panel.scrollTop = 400
    fireEvent.scroll(panel)
    expect(panel).not.toHaveAttribute('data-more-below')
  })

  it('refits the column when the sticky header changes height', async () => {
    const header = document.createElement('header')
    header.className = 'portal-header'
    document.body.append(header)
    const root = document.documentElement
    root.style.setProperty('--portal-header-height', '60px')
    try {
      const column = renderSidebar().parentElement!
      const before = column.style.maxHeight
      expect(before).toBe(`${window.innerHeight - 60 - 24 - 24}px`)

      // A late font makes the header taller; the header publishes its height.
      root.style.setProperty('--portal-header-height', '120px')
      observed.get(header)?.([], {} as ResizeObserver)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(column.style.maxHeight).toBe(`${window.innerHeight - 120 - 24 - 24}px`)
    } finally {
      header.remove()
      root.style.removeProperty('--portal-header-height')
    }
  })

  it('shows no fade when the panel fits', () => {
    const panel = renderSidebar()
    sizePanel(panel, { scrollHeight: 400, clientHeight: 400 })
    resize()
    expect(panel).not.toHaveAttribute('data-more-below')
  })
})
