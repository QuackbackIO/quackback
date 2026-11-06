import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeedHandoff } from '../feed-input-handoff'

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
