/**
 * When a loaded page is ready to measure: once its network has been quiet a
 * moment (its late scripts, fonts and styles in), never before a short floor,
 * and never past the settle budget for a page that keeps polling.
 */
import { describe, expect, it } from 'vitest'
import { settled } from '../read-page'

describe('settled', () => {
  it('waits for the floor even on a quiet page', () => {
    expect(settled({ pending: 0, lastActivity: 0 }, 500)).toBe(false)
    expect(settled({ pending: 0, lastActivity: 0 }, 1_000)).toBe(true)
  })

  it('waits while requests are in flight, and a moment after the last one', () => {
    expect(settled({ pending: 2, lastActivity: 900 }, 1_500)).toBe(false)
    expect(settled({ pending: 0, lastActivity: 1_400 }, 1_600)).toBe(false)
    expect(settled({ pending: 0, lastActivity: 1_400 }, 1_900)).toBe(true)
  })

  it('stops waiting at the budget for a page that never goes quiet', () => {
    expect(settled({ pending: 5, lastActivity: 2_990 }, 3_000)).toBe(true)
  })
})
