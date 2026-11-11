// @vitest-environment happy-dom
/**
 * What the builder says aloud shows in its live region, cleared first so a
 * repeat is read again, and saying it renders that region alone: the builder
 * around it, which holds the whole page, does not render again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SaidRegion, useSaid } from '../use-said'

const draft = { undo: vi.fn(), redo: vi.fn(), undoLabel: 'Brand colour', redoLabel: null }

let renders = 0
let say: (text: string) => void = () => {}
function Builder() {
  renders++
  const said = useSaid(draft)
  say = said.say
  return <SaidRegion said={said.said} />
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] })
  renders = 0
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useSaid', () => {
  it('says it in the live region without rendering the builder again', () => {
    render(<Builder />)
    const before = renders
    act(() => say('Top posts selected. Its settings are on the right.'))
    act(() => vi.advanceTimersByTime(20))
    expect(screen.getByRole('status').textContent).toBe(
      'Top posts selected. Its settings are on the right.'
    )
    expect(renders).toBe(before)
  })

  it('clears the region first, so the same words are read again', () => {
    render(<Builder />)
    act(() => say('Moved.'))
    act(() => vi.advanceTimersByTime(20))
    act(() => say('Moved.'))
    expect(screen.getByRole('status').textContent).toBe('')
    act(() => vi.advanceTimersByTime(20))
    expect(screen.getByRole('status').textContent).toBe('Moved.')
  })
})
