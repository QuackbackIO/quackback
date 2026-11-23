// @vitest-environment happy-dom
/**
 * Try again on the feedback inbox's load error re-runs the loader (FBA-I-32):
 * resetting the error boundary alone re-renders the same failed result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const invalidate = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }))

const { FeedbackLoadError } = await import('../feedback-load-error')

afterEach(() => {
  cleanup()
  invalidate.mockClear()
})

describe('FeedbackLoadError', () => {
  it('re-runs the loader and resets the boundary on Try again', () => {
    const reset = vi.fn()
    render(<FeedbackLoadError error={new Error('Inbox is down')} reset={reset} />)
    expect(screen.getByText('Failed to load feedback')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
