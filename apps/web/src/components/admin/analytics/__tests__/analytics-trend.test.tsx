// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendDelta } from '../analytics-trend'

describe('<TrendDelta>', () => {
  it('renders a positive delta with a + sign and success color', () => {
    const { container } = render(<TrendDelta value={12} />)
    expect(screen.getByText(/\+12%/)).toBeInTheDocument()
    expect(container.firstElementChild?.className).toContain('text-success')
  })

  it('renders a negative delta with destructive color', () => {
    const { container } = render(<TrendDelta value={-8} />)
    expect(screen.getByText(/-8%/)).toBeInTheDocument()
    expect(container.firstElementChild?.className).toContain('text-destructive')
  })

  it('reserves an empty, non-announced slot when the delta is zero', () => {
    const { container } = render(<TrendDelta value={0} />)
    const el = container.firstElementChild
    expect(el).not.toBeNull()
    expect(el).toHaveAttribute('aria-hidden')
    expect(el?.textContent).toBe('')
  })

  it('renders the suffix when provided', () => {
    render(<TrendDelta value={5} suffix="vs prev" />)
    expect(screen.getByText('vs prev')).toBeInTheDocument()
  })
})
