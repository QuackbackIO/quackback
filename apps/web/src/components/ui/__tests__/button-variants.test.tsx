// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Button } from '../button'

afterEach(cleanup)

describe('Button outline-destructive', () => {
  it('is the one outline red style for danger-zone actions', () => {
    render(<Button variant="outline-destructive">Delete board</Button>)
    const { classList } = screen.getByRole('button', { name: 'Delete board' })
    expect(classList.contains('text-destructive')).toBe(true)
    expect(classList.contains('border-destructive/40')).toBe(true)
    expect(classList.contains('bg-transparent')).toBe(true)
    // Never a filled red or the primary fill.
    expect(classList.contains('bg-destructive')).toBe(false)
    expect(classList.contains('bg-primary')).toBe(false)
  })
})

describe('Button touch targets', () => {
  it.each(['sm', 'icon-sm'] as const)(
    'extends the %s hit area to 44px on a coarse pointer without growing the button',
    (size) => {
      render(<Button size={size}>Copy</Button>)
      const { className } = screen.getByRole('button', { name: 'Copy' })
      expect(className).toContain('relative')
      expect(className).toContain('pointer-coarse:after:absolute')
      expect(className).toContain('pointer-coarse:after:-inset-y-1.5')
      expect(className).toContain('pointer-coarse:after:inset-x-0')
    }
  )

  it('leaves the default size alone', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' }).className).not.toContain('pointer-coarse')
  })
})
