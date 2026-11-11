// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TextButton } from '../text-button'

describe('TextButton', () => {
  it('is a 24px tall button that does not submit forms', () => {
    render(<TextButton>Reset</TextButton>)
    const button = screen.getByRole('button', { name: 'Reset' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('min-h-6', 'text-2xs', 'hover:underline')
    expect(button).not.toHaveClass('underline')
  })

  it('keeps the underline drawn when underlined', () => {
    render(<TextButton underlined>Show me</TextButton>)
    expect(screen.getByRole('button', { name: 'Show me' })).toHaveClass('underline')
  })
})
