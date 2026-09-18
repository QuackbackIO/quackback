import { describe, expect, it } from 'vitest'
import { inactivityAction, type InactivityState } from '../../conversation/conversation.inactivity'
import { DEFAULT_CONVERSATION_INACTIVITY } from '@/lib/shared/conversation-inactivity'
const now = new Date('2026-09-18T12:00:00Z')
const state: InactivityState = {
  channel: 'messenger',
  status: 'open',
  inactivityOwner: 'assistant_answered',
  inactivityAnchorAt: new Date(now.getTime() - 16 * 60_000),
  inactivityCheckInAt: null,
}
const settings = () => structuredClone(DEFAULT_CONVERSATION_INACTIVITY)
describe('assistant inactivity closure policy', () => {
  it('closes after a substantive answer', () =>
    expect(inactivityAction(state, settings(), now)).toBe('close'))
  it('can keep answered conversations open while closing unanswered waits', () => {
    const s = settings()
    s.assistant.closeWhenAnswered = false
    s.assistant.followUpEnabled = false
    expect(inactivityAction(state, s, now)).toBeNull()
    expect(inactivityAction({ ...state, inactivityOwner: 'assistant_waiting' }, s, now)).toBe(
      'close'
    )
  })
  it('can close answered conversations without closing clarification waits', () => {
    const s = settings()
    s.assistant.closeWhenUnanswered = false
    expect(inactivityAction({ ...state, inactivityOwner: 'assistant_waiting' }, s, now)).toBeNull()
  })
  it('does not act on a handoff, snooze, closed thread or cancelled period', () => {
    for (const patch of [
      { inactivityOwner: 'handoff' as const },
      { status: 'snoozed' },
      { status: 'closed' },
      { inactivityAnchorAt: null },
    ])
      expect(inactivityAction({ ...state, ...patch }, settings(), now)).toBeNull()
  })
  it('uses the email closure window independently', () =>
    expect(inactivityAction({ ...state, channel: 'email' }, settings(), now)).toBeNull())
  it('has no built-in fallback under custom workflows or Off', () => {
    for (const mode of ['custom', 'off'] as const) {
      const s = settings()
      s.channels!.messenger = mode
      expect(inactivityAction(state, s, now)).toBeNull()
    }
  })
})
