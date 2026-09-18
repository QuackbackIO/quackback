import { describe, expect, it } from 'vitest'
import { DEFAULT_CONVERSATION_INACTIVITY } from '@/lib/shared/conversation-inactivity'
import { idleActionFor, idleChannelGroup } from '../conversation.idle-sweep'

const now = new Date('2026-09-17T12:00:00.000Z')

function minutesAgo(n: number): Date {
  return new Date(now.getTime() - n * 60_000)
}

function hoursAgo(n: number): Date {
  return new Date(now.getTime() - n * 3_600_000)
}

describe('idleChannelGroup', () => {
  it('maps messenger to the widget group', () => {
    expect(idleChannelGroup('messenger')).toBe('messenger')
  })

  it('maps email to the mailbox group', () => {
    expect(idleChannelGroup('email')).toBe('email')
  })

  it('never auto-closes a native-close channel', () => {
    expect(idleChannelGroup('github')).toBeNull()
  })
})

describe('idleActionFor', () => {
  it('checks in on a messenger thread after 15 minutes when the visitor is online', () => {
    expect(
      idleActionFor(
        { channel: 'messenger', lastMessageAt: minutesAgo(16), inactivityCheckInAt: null },
        DEFAULT_CONVERSATION_INACTIVITY,
        now,
        true
      )
    ).toBe('check_in')
  })

  it('skips the messenger check-in when the visitor is offline', () => {
    expect(
      idleActionFor(
        { channel: 'messenger', lastMessageAt: minutesAgo(16), inactivityCheckInAt: null },
        DEFAULT_CONVERSATION_INACTIVITY,
        now,
        false
      )
    ).toBeNull()
  })

  it('does not check in twice in the same silence', () => {
    expect(
      idleActionFor(
        {
          channel: 'messenger',
          lastMessageAt: minutesAgo(20),
          inactivityCheckInAt: minutesAgo(4),
        },
        DEFAULT_CONVERSATION_INACTIVITY,
        now,
        true
      )
    ).toBeNull()
  })

  it('closes a messenger thread after 30 minutes', () => {
    expect(
      idleActionFor(
        {
          channel: 'messenger',
          lastMessageAt: minutesAgo(31),
          inactivityCheckInAt: minutesAgo(15),
        },
        DEFAULT_CONVERSATION_INACTIVITY,
        now,
        true
      )
    ).toBe('close')
  })

  it('closes email after 72 hours with no check-in by default', () => {
    expect(
      idleActionFor(
        { channel: 'email', lastMessageAt: hoursAgo(73), inactivityCheckInAt: null },
        DEFAULT_CONVERSATION_INACTIVITY,
        now,
        false
      )
    ).toBe('close')
  })

  it('does not nudge email before the close window when check-in is off', () => {
    expect(
      idleActionFor(
        { channel: 'email', lastMessageAt: hoursAgo(24), inactivityCheckInAt: null },
        DEFAULT_CONVERSATION_INACTIVITY,
        now,
        false
      )
    ).toBeNull()
  })

  it('never acts on github', () => {
    expect(
      idleActionFor(
        { channel: 'github', lastMessageAt: hoursAgo(100), inactivityCheckInAt: null },
        DEFAULT_CONVERSATION_INACTIVITY,
        now,
        true
      )
    ).toBeNull()
  })

  it('does nothing when the messenger section is disabled', () => {
    expect(
      idleActionFor(
        { channel: 'messenger', lastMessageAt: minutesAgo(40), inactivityCheckInAt: null },
        {
          ...DEFAULT_CONVERSATION_INACTIVITY,
          messenger: { ...DEFAULT_CONVERSATION_INACTIVITY.messenger, enabled: false },
        },
        now,
        true
      )
    ).toBeNull()
  })
})
