// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { RoundTripStep } from '../try-messenger-sheet'

afterEach(cleanup)

it('shows a done step with a check and muted text, never struck through', () => {
  render(
    <ol>
      <RoundTripStep done index={1}>
        Send a message
      </RoundTripStep>
    </ol>
  )
  const text = screen.getByText('Send a message')
  expect(text.className).toContain('text-muted-foreground')
  expect(text.className).not.toContain('line-through')
})
