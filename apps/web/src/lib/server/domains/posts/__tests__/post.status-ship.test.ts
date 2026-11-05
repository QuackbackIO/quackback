import { describe, expect, it } from 'vitest'
import { entersComplete } from '../post.status'

describe('a status change that ships something', () => {
  it('is a move into a complete status from one that is not complete', () => {
    expect(entersComplete('active', 'complete')).toBe(true)
    expect(entersComplete(null, 'complete')).toBe(true)
  })

  it('is not housekeeping between complete statuses, or a repeat of the same one', () => {
    expect(entersComplete('complete', 'complete')).toBe(false)
  })

  it('is not a move anywhere else', () => {
    expect(entersComplete('active', 'active')).toBe(false)
    expect(entersComplete('complete', 'active')).toBe(false)
    expect(entersComplete('active', 'closed')).toBe(false)
  })
})
