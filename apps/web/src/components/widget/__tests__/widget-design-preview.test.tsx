// @vitest-environment happy-dom
/**
 * The builder's Widget sample frames the real widget and posts the draft
 * design into it: the widget then draws in the draft, and nothing in it can
 * be used. Only the page that frames it may post a design.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('@/lib/shared/theme/font-loader', () => ({ loadBrandingFont: vi.fn(async () => {}) }))

const { WidgetDesignPreview } = await import('../widget-design-preview')

const parent = { postMessage: vi.fn() }
let realParent: PropertyDescriptor | undefined

beforeEach(() => {
  realParent = Object.getOwnPropertyDescriptor(window, 'parent')
  Object.defineProperty(window, 'parent', { value: parent, configurable: true })
})
afterEach(() => {
  cleanup()
  if (realParent) Object.defineProperty(window, 'parent', realParent)
  parent.postMessage.mockClear()
  document.documentElement.removeAttribute('data-qb-look')
})

const design = {
  css: ':root{--primary:#123456}',
  attributes: { 'data-qb-look': 'soft' },
  fontIds: [],
}

function post(from: unknown, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:preview-design', design },
        origin,
        source: from as MessageEventSource,
      })
    )
  })
}

describe('WidgetDesignPreview', () => {
  it('says it is ready, then draws the design the builder posts', () => {
    const { container } = render(<WidgetDesignPreview />)
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quackback:preview-ready' }),
      window.location.origin
    )
    post(parent)
    expect(container.querySelector('style[data-preview-design]')?.textContent).toBe(design.css)
    expect(document.documentElement.getAttribute('data-qb-look')).toBe('soft')
  })

  it('takes a design only from the page that frames it', () => {
    const { container } = render(<WidgetDesignPreview />)
    post(window)
    post(parent, 'https://elsewhere.example')
    expect(container.querySelector('style')).toBeNull()
  })

  it('is a picture: clicks do nothing', () => {
    render(<WidgetDesignPreview />)
    const button = document.createElement('button')
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    document.body.append(button)
    fireEvent.click(button)
    expect(clicked).not.toHaveBeenCalled()
    button.remove()
  })
})
