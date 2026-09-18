import { describe, expect, it } from 'vitest'
import { inactivityAction, type InactivityState } from '../../conversation/conversation.inactivity'
import { DEFAULT_CONVERSATION_INACTIVITY } from '@/lib/shared/conversation-inactivity'
const now = new Date('2026-09-18T12:00:00Z')
const state: InactivityState = {
  channel: 'messenger',
  status: 'open',
  inactivityOwner: 'assistant_answered',
  inactivityAnchorAt: new Date(now.getTime() - 6 * 60_000),
  inactivityCheckInAt: null,
}
describe('assistant follow-up policy', () => {
  it('follows up after an answer, even when auto-close is disabled', () => {
    const s = structuredClone(DEFAULT_CONVERSATION_INACTIVITY)
    s.assistant.closeEnabled = false
    expect(inactivityAction(state, s, now)).toBe('follow_up')
  })
  it('never follows up clarification-only waits', () =>
    expect(
      inactivityAction(
        { ...state, inactivityOwner: 'assistant_waiting' },
        DEFAULT_CONVERSATION_INACTIVITY,
        now
      )
    ).toBeNull())
  it('does not repeat a follow-up in the same period', () =>
    expect(
      inactivityAction({ ...state, inactivityCheckInAt: now }, DEFAULT_CONVERSATION_INACTIVITY, now)
    ).toBeNull())
  it('uses the original anchor for closure, even after a nudge', () =>
    expect(
      inactivityAction(
        { ...state, inactivityCheckInAt: now },
        DEFAULT_CONVERSATION_INACTIVITY,
        new Date(now.getTime() + 10 * 60_000)
      )
    ).toBe('close'))
})
