import { describe, expect, it } from 'vitest'
import { canPostTo } from '../feedback-container'

const PERMISSIONS = {
  board_open: { canSubmit: true },
  board_locked: { canSubmit: false },
}

describe('canPostTo', () => {
  it('lets the board the composer is locked to decide', () => {
    expect(canPostTo(PERMISSIONS, 'board_locked')).toBe(false)
    expect(canPostTo(PERMISSIONS, 'board_open')).toBe(true)
  })

  it('takes any board on the whole feed', () => {
    expect(canPostTo(PERMISSIONS, undefined)).toBe(true)
    expect(canPostTo({ board_locked: { canSubmit: false } }, undefined)).toBe(false)
  })
})
