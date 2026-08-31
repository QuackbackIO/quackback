// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WidgetLastDetected } from '../widget-last-detected'

describe('WidgetLastDetected', () => {
  it('renders nothing without a date', () => {
    const { container } = render(<WidgetLastDetected at={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a relative last-detected time', () => {
    render(<WidgetLastDetected at={new Date().toISOString()} />)
    expect(screen.getByText(/Last detected/)).toBeInTheDocument()
    expect(screen.getByText(/ago/)).toBeInTheDocument()
  })
})
