import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONVERSATION_INACTIVITY,
  assistantFollowUpDue,
  assistantInvolvementIsStale,
  assistantWindows,
} from '@/lib/shared/conversation-inactivity'

const MIN = 60_000
const HOUR = 3_600_000

describe('assistantWindows', () => {
  it('uses the chat minute clocks for messenger', () => {
    expect(assistantWindows(DEFAULT_CONVERSATION_INACTIVITY, 'messenger')).toEqual({
      checkInMs: 5 * MIN,
      closeMs: 15 * MIN,
    })
  })

  it('uses the hours-scale clocks for email', () => {
    expect(assistantWindows(DEFAULT_CONVERSATION_INACTIVITY, 'email')).toEqual({
      checkInMs: 24 * HOUR,
      closeMs: 72 * HOUR,
    })
  })

  it('honours a chat-only close override', () => {
    expect(
      assistantWindows(DEFAULT_CONVERSATION_INACTIVITY, 'messenger', { chatCloseMinutes: 10 })
        .closeMs
    ).toBe(10 * MIN)
    expect(
      assistantWindows(DEFAULT_CONVERSATION_INACTIVITY, 'email', { chatCloseMinutes: 10 }).closeMs
    ).toBe(72 * HOUR)
  })

  it('returns a null email check-in when follow-up mail is off', () => {
    const settings = {
      ...DEFAULT_CONVERSATION_INACTIVITY,
      assistant: {
        ...DEFAULT_CONVERSATION_INACTIVITY.assistant,
        email: { checkInHours: null, closeHours: 72 },
      },
    }
    expect(assistantWindows(settings, 'email').checkInMs).toBeNull()
    expect(assistantWindows(settings, 'email').closeMs).toBe(72 * HOUR)
  })
})

describe('assistantInvolvementIsStale', () => {
  it('marks messenger stale at 15 minutes, not 14', () => {
    expect(
      assistantInvolvementIsStale({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'messenger',
        elapsedMs: 14 * MIN,
      })
    ).toBe(false)
    expect(
      assistantInvolvementIsStale({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'messenger',
        elapsedMs: 15 * MIN,
      })
    ).toBe(true)
  })

  it('leaves email untouched at 15 minutes and 23 hours', () => {
    expect(
      assistantInvolvementIsStale({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'email',
        elapsedMs: 15 * MIN,
      })
    ).toBe(false)
    expect(
      assistantInvolvementIsStale({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'email',
        elapsedMs: 23 * HOUR,
      })
    ).toBe(false)
  })

  it('marks email stale at 72 hours', () => {
    expect(
      assistantInvolvementIsStale({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'email',
        elapsedMs: 72 * HOUR,
      })
    ).toBe(true)
  })
})

describe('assistantFollowUpDue', () => {
  it('is due on messenger at 5 minutes and still before close', () => {
    expect(
      assistantFollowUpDue({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'messenger',
        elapsedMs: 4 * MIN,
      })
    ).toBe(false)
    expect(
      assistantFollowUpDue({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'messenger',
        elapsedMs: 5 * MIN,
      })
    ).toBe(true)
    expect(
      assistantFollowUpDue({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'messenger',
        elapsedMs: 15 * MIN,
      })
    ).toBe(false)
  })

  it('is due on email at 24 hours and still before 72 hours', () => {
    expect(
      assistantFollowUpDue({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'email',
        elapsedMs: 23 * HOUR,
      })
    ).toBe(false)
    expect(
      assistantFollowUpDue({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'email',
        elapsedMs: 24 * HOUR,
      })
    ).toBe(true)
    expect(
      assistantFollowUpDue({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'email',
        elapsedMs: 71 * HOUR,
      })
    ).toBe(true)
    expect(
      assistantFollowUpDue({
        settings: DEFAULT_CONVERSATION_INACTIVITY,
        group: 'email',
        elapsedMs: 72 * HOUR,
      })
    ).toBe(false)
  })

  it('skips the email follow-up when checkInHours is null', () => {
    const settings = {
      ...DEFAULT_CONVERSATION_INACTIVITY,
      assistant: {
        ...DEFAULT_CONVERSATION_INACTIVITY.assistant,
        email: { checkInHours: null, closeHours: 72 },
      },
    }
    expect(assistantFollowUpDue({ settings, group: 'email', elapsedMs: 24 * HOUR })).toBe(false)
  })

  it('does not follow up when auto-close is disabled', () => {
    const settings = {
      ...DEFAULT_CONVERSATION_INACTIVITY,
      assistant: { ...DEFAULT_CONVERSATION_INACTIVITY.assistant, enabled: false },
    }
    expect(assistantFollowUpDue({ settings, group: 'messenger', elapsedMs: 5 * MIN })).toBe(false)
    expect(assistantFollowUpDue({ settings, group: 'email', elapsedMs: 24 * HOUR })).toBe(false)
  })
})
