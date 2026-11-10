// @vitest-environment happy-dom
/**
 * A change the server would refuse says why in one line under the row whose
 * control made it, not in a toast; a change made away from any row says it
 * in the builder's own notice line.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PropertyRow } from '../properties/properties-panel'
import { RefusalLines, RefusalFallback, useRefusalLines } from '../properties/change-refusal'

afterEach(cleanup)

let refuse: (message: string) => void = () => {}
let clear: () => void = () => {}

function Harness() {
  const lines = useRefusalLines()
  refuse = lines.refuse
  clear = lines.clear
  return (
    <RefusalLines value={lines.value}>
      <div data-testid="corners">
        <PropertyRow label="Corners">
          <button type="button">Round</button>
        </PropertyRow>
      </div>
      <div data-testid="size">
        <PropertyRow label="Size">
          <button type="button">Large</button>
        </PropertyRow>
      </div>
      <button type="button">Away</button>
      <RefusalFallback value={lines.value} />
    </RefusalLines>
  )
}

describe('refusal lines', () => {
  it('shows the reason under the row that made the change, until a change commits', () => {
    render(<Harness />)
    const size = screen.getByTestId('size')
    fireEvent.pointerDown(within(size).getByRole('button', { name: 'Large' }))
    act(() => refuse('Use 999 or less'))
    expect(within(size).getByRole('alert').textContent).toBe('Use 999 or less')
    expect(within(screen.getByTestId('corners')).queryByRole('alert')).toBeNull()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    act(() => clear())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('moves to the row touched last, by keyboard too', () => {
    render(<Harness />)
    fireEvent.pointerDown(within(screen.getByTestId('size')).getByRole('button'))
    fireEvent.keyDown(within(screen.getByTestId('corners')).getByRole('button'), { key: 'Enter' })
    act(() => refuse('Can’t be empty'))
    expect(within(screen.getByTestId('corners')).getByRole('alert').textContent).toBe(
      'Can’t be empty'
    )
  })

  it('says it in the notice line when no row made the change', () => {
    render(<Harness />)
    fireEvent.pointerDown(within(screen.getByTestId('size')).getByRole('button'))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Away' }))
    act(() => refuse('Text wouldn’t be readable with this'))
    const alert = screen.getByRole('alert')
    expect(within(screen.getByTestId('size')).queryByRole('alert')).toBeNull()
    expect(alert.textContent).toBe('Text wouldn’t be readable with this')
  })
})
