// @vitest-environment happy-dom
/** F6 and Shift+F6 move between the builder's regions, in the order they show. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { cycleRegions } from '../regions'

beforeAll(() => window.addEventListener('keydown', cycleRegions))
afterAll(() => window.removeEventListener('keydown', cycleRegions))
afterEach(cleanup)

function Builder({ flyout = true }) {
  return (
    <div>
      <header data-designer-region="" tabIndex={-1} aria-label="Top bar">
        <button type="button">Publish</button>
      </header>
      <div role="toolbar" aria-label="Builder" data-designer-region="">
        <button type="button" tabIndex={-1}>
          Pages
        </button>
        <button type="button" tabIndex={0}>
          Styles
        </button>
      </div>
      {flyout && <section data-designer-region="" tabIndex={-1} aria-label="Styles" />}
      <aside data-designer-region="" tabIndex={-1} aria-label="Settings" />
    </div>
  )
}

const f6 = (shift = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F6', shiftKey: shift })

describe('cycleRegions', () => {
  it('goes to the next region, and from the last back to the first', () => {
    render(<Builder />)
    screen.getByRole('button', { name: 'Publish' }).focus()
    f6()
    // The rail takes focus on its button that takes Tab, not on itself.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Styles' }))
    f6()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Styles')
    f6()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Settings')
    f6()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Top bar')
  })

  it('starts at the top bar from the page’s body', () => {
    render(<Builder />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document.body, { key: 'F6' })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Top bar')
  })

  it('goes back with Shift, and skips a panel that is closed', () => {
    render(<Builder flyout={false} />)
    screen.getByRole('button', { name: 'Publish' }).focus()
    f6(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Settings')
    f6(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Styles' }))
  })
})
