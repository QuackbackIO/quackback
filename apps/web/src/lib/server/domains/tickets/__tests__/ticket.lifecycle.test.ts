/**
 * Pure lifecycle rules (no db): stage projection, resolve/reopen transitions,
 * and the once-only first-response stamp.
 */
import { describe, it, expect } from 'vitest'
import { resolveStage, statusTransition, firstResponseStamp } from '../ticket.lifecycle'

describe('resolveStage', () => {
  it('returns the status public stage', () => {
    expect(resolveStage({ publicStage: 'in_progress' })).toBe('in_progress')
  })

  it('returns null for an internal-only (hidden) status', () => {
    expect(resolveStage({ publicStage: null })).toBeNull()
  })
})

describe('statusTransition', () => {
  const now = new Date('2026-07-03T12:00:00.000Z')

  it('stamps resolvedAt when entering a closed status', () => {
    const t = statusTransition('open', 'closed', now)
    expect(t.resolvedAt).toEqual(now)
    expect(t.reopenedIncrement).toBe(0)
  })

  it('clears resolvedAt and counts a reopen when leaving closed', () => {
    const t = statusTransition('closed', 'open', now)
    expect(t.resolvedAt).toBeNull()
    expect(t.reopenedIncrement).toBe(1)
  })

  it('leaves resolvedAt untouched moving between two non-closed categories', () => {
    const t = statusTransition('open', 'pending', now)
    expect(t.resolvedAt).toBeUndefined()
    expect(t.reopenedIncrement).toBe(0)
  })

  it('does not re-stamp or reopen moving between two closed statuses', () => {
    const t = statusTransition('closed', 'closed', now)
    expect(t.resolvedAt).toBeUndefined()
    expect(t.reopenedIncrement).toBe(0)
  })
})

describe('firstResponseStamp', () => {
  const now = new Date('2026-07-03T12:00:00.000Z')

  it('stamps on the first agent action', () => {
    expect(firstResponseStamp(null, true, now)).toEqual(now)
  })

  it('never overwrites an existing stamp', () => {
    expect(firstResponseStamp(new Date('2020-01-01'), true, now)).toBeUndefined()
  })

  it('does not stamp for a non-agent action', () => {
    expect(firstResponseStamp(null, false, now)).toBeUndefined()
  })
})
