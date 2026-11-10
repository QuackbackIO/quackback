// @vitest-environment happy-dom
/**
 * View options: how the page is shown while editing, as rows of tiles. They
 * change nothing in the design. Preview as shows only when visitors choose
 * light or dark, and nothing explains itself in a paragraph.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const { ViewOptions } = await import('../view-options')

/** A target at least 24px tall, as small text links and buttons are given. */
const at24 = (el: Element) => expect(el.className).toMatch(/(^|\s)(min-h-6|size-6|min-h-7)(\s|$)/)

afterEach(cleanup)

function setup(mode: 'light' | 'dark' | 'auto') {
  const onTheme = vi.fn()
  const onVisitor = vi.fn()
  const view = render(
    <ViewOptions
      mode={mode}
      theme="light"
      onTheme={onTheme}
      locale="en"
      onLocale={() => {}}
      visitor="out"
      onVisitor={onVisitor}
      onKeys={() => {}}
    />
  )
  return { onTheme, onVisitor, view }
}

const radio = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })

describe('ViewOptions', () => {
  it('previews light or dark only where visitors choose', () => {
    setup('light')
    expect(screen.queryByRole('radiogroup', { name: 'Preview as' })).toBeNull()
    cleanup()
    const { onTheme } = setup('auto')
    fireEvent.click(radio('Preview as', 'Dark'))
    expect(onTheme).toHaveBeenCalledWith('dark')
  })

  it('gives the keyboard shortcuts link a target 24px tall', () => {
    setup('light')
    at24(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
  })

  it('picks the visitor from tiles, with no paragraph', () => {
    const { onVisitor, view } = setup('auto')
    expect(radio('Visitor', 'Signed out').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(radio('Visitor', 'Signed in'))
    expect(onVisitor).toHaveBeenCalledWith('in')
    expect(view.container.querySelector('p')).toBeNull()
  })
})
