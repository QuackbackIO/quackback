import { describe, it, expect } from 'vitest'
import { selectActiveConversation } from '../chat.query'
import type { Conversation } from '@/lib/server/db'

// Minimal rows — selectActiveConversation only reads `status`.
const row = (status: string): Conversation => ({ status }) as unknown as Conversation

describe('selectActiveConversation', () => {
  it('returns null + not-read-only when there are no conversations', () => {
    expect(selectActiveConversation([])).toEqual({ conversation: null, isReadOnly: false })
  })

  it('treats open / pending as resumable (visitor can still reply)', () => {
    expect(selectActiveConversation([row('open')]).isReadOnly).toBe(false)
    expect(selectActiveConversation([row('pending')]).isReadOnly).toBe(false)
  })

  it('surfaces a lone closed conversation read-only (so the widget offers "start new")', () => {
    const r = row('closed')
    expect(selectActiveConversation([r])).toEqual({ conversation: r, isReadOnly: true })
  })

  it('prefers a resumable thread over a more-recent closed one', () => {
    // rows arrive most-recent-first; the closed one is newer but open wins.
    const closed = row('closed')
    const open = row('open')
    const result = selectActiveConversation([closed, open])
    expect(result.conversation).toBe(open)
    expect(result.isReadOnly).toBe(false)
  })

  it('falls back to the most-recent closed when none are resumable', () => {
    const newer = row('closed')
    const older = row('closed')
    const result = selectActiveConversation([newer, older])
    expect(result.conversation).toBe(newer)
    expect(result.isReadOnly).toBe(true)
  })
})
