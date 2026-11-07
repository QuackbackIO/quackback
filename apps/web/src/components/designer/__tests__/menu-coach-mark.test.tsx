// @vitest-environment happy-dom
/**
 * The menu's hint: one short line, shown only while the menu is hovered or
 * picked, under the header so it never covers the picked part, closed by
 * Got it or Escape. The brand coach points at Match your brand instead while
 * no match has run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/client/hooks/use-root-context', () => ({ useSessionContext: () => null }))
const { MenuCoachMark, menuHintShown } = await import('../menu-coach-mark')

afterEach(cleanup)

const row = { left: 120, top: 10, width: 200, height: 24 }
const header = { left: 0, top: 0, width: 800, height: 64 }

describe('MenuCoachMark', () => {
  it('says one short line, under the header, and closes on Got it', () => {
    const onDismiss = vi.fn()
    render(
      <MenuCoachMark
        row={row}
        below={header}
        room={{ width: 800, height: 600 }}
        onDismiss={onDismiss}
      />
    )
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('Pick an item to rename or move it.')
    expect(note.textContent).not.toMatch(/double-click|drag/i)
    // Under the whole header, never over it: the header may be the picked part.
    expect(Number.parseFloat(note.style.top)).toBeGreaterThanOrEqual(header.top + header.height)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const onDismiss = vi.fn()
    render(<MenuCoachMark row={row} room={{ width: 800, height: 600 }} onDismiss={onDismiss} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('menuHintShown', () => {
  const base = { show: true, hasRow: true, hot: true, open: false, dragging: false }
  it('shows only while the menu is hovered or picked, and nothing else is open', () => {
    expect(menuHintShown(base)).toBe(true)
    expect(menuHintShown({ ...base, hot: false })).toBe(false)
    expect(menuHintShown({ ...base, open: true })).toBe(false)
    expect(menuHintShown({ ...base, dragging: true })).toBe(false)
    expect(menuHintShown({ ...base, show: false })).toBe(false)
  })
})
