// @vitest-environment happy-dom
/** The keys dialog lists the builder's keys as they are, and no part it no longer has. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ShortcutsDialog } from '../shortcuts-dialog'

afterEach(cleanup)

describe('ShortcutsDialog', () => {
  it('names the regions F6 moves between and the tree’s keys, with no rail', () => {
    render(<ShortcutsDialog open onOpenChange={() => {}} />)
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).not.toMatch(/rail/i)
    expect(text).toContain('Move between the top bar, Ask AI, the canvas and the properties')
    expect(text).toContain('On this page')
    expect(text).toContain('Alt+Up, Alt+Down')
    expect(text).toContain('Open Ask AI')
  })
})
