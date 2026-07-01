import { describe, it, expect } from 'vitest'
import { draftFromMessage } from '../suggest-from-message'

describe('draftFromMessage', () => {
  it('uses trimmed message as title, capped at 200', () => {
    expect(draftFromMessage('  Dark mode please  ', 'board_1')).toEqual({
      ok: true,
      title: 'Dark mode please',
      boardId: 'board_1',
    })
    const long = 'x'.repeat(250)
    expect((draftFromMessage(long, 'board_1') as { title: string }).title).toHaveLength(200)
  })

  it('declines (fallback to dialog) when <3 chars or no board', () => {
    expect(draftFromMessage('hi', 'board_1')).toEqual({ ok: false })
    expect(draftFromMessage('valid text', undefined)).toEqual({ ok: false })
  })
})
