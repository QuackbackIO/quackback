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
