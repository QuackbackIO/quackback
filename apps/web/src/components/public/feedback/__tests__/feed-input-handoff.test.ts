import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeedHandoff, takeArrivedTitle } from '../feed-input-handoff'

describe('feed input handoff', () => {
  afterEach(() => vi.useRealTimers())

  it('hands each value over once', () => {
    const handoff = createFeedHandoff()
    handoff.handOff({ search: 'zap', composeTitle: 'Dark mode' })
    expect(handoff.take('search')).toBe('zap')
    expect(handoff.take('search')).toBeUndefined()
    expect(handoff.take('composeTitle')).toBe('Dark mode')
  })

  it('keeps each feed to its own input, so a feed left behind cannot reach the next one', () => {
    const left = createFeedHandoff()
    left.handOff({ search: 'zap', composeTitle: 'Dark mode' })
    const next = createFeedHandoff()
    expect(next.take('search')).toBeUndefined()
    expect(next.take('composeTitle')).toBeUndefined()
  })

  it('drops input nobody took in time', () => {
    vi.useFakeTimers()
    const handoff = createFeedHandoff()
    handoff.handOff({ search: 'zap' })
    vi.advanceTimersByTime(5000)
    expect(handoff.take('search')).toBeUndefined()
  })

  it('does not revive an expired value when new input is handed over', () => {
    vi.useFakeTimers()
    const handoff = createFeedHandoff()
    handoff.handOff({ composeTitle: 'Abandoned idea' })
    vi.advanceTimersByTime(5000)
    handoff.handOff({ search: 'zap' })
    expect(handoff.take('composeTitle')).toBeUndefined()
    expect(handoff.take('search')).toBe('zap')
  })
})

describe('takeArrivedTitle', () => {
  it('opens an arrival’s title once, so a feed that mounts again leaves it closed', () => {
    const arrival = { composeTitle: 'Dark mode' }
    expect(takeArrivedTitle(arrival)).toBe('Dark mode')
    expect(takeArrivedTitle(arrival)).toBeUndefined()
    // A new arrival with the same title opens again.
    expect(takeArrivedTitle({ composeTitle: 'Dark mode' })).toBe('Dark mode')
  })

  it('opens an empty title, and ignores any other state', () => {
    expect(takeArrivedTitle({ composeTitle: '' })).toBe('')
    expect(takeArrivedTitle({ composeTitle: 3 })).toBeUndefined()
    expect(takeArrivedTitle({ __TSR_key: 'abc' })).toBeUndefined()
    expect(takeArrivedTitle(undefined)).toBeUndefined()
    expect(takeArrivedTitle(null)).toBeUndefined()
  })
})
