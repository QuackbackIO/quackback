import { describe, it, expect } from 'vitest'
import { shouldNotify } from './notification-matrix'
import type { NotificationPreferencesData } from './subscription.types'

const basePrefs: NotificationPreferencesData = {
  emailStatusChange: true,
  emailNewComment: true,
  emailMuted: false,
}

describe('shouldNotify', () => {
  it('defaults to true for all channels with no matrix and no legacy override', () => {
    expect(shouldNotify(basePrefs, 'comment_created', 'inApp')).toBe(true)
    expect(shouldNotify(basePrefs, 'comment_created', 'email')).toBe(true)
    expect(shouldNotify(basePrefs, 'comment_created', 'push')).toBe(true)
  })

  it('respects the legacy emailNewComment=false override for comment_created+email only', () => {
    const prefs: NotificationPreferencesData = { ...basePrefs, emailNewComment: false }
    expect(shouldNotify(prefs, 'comment_created', 'email')).toBe(false)
    // in-app ignores the legacy email boolean
    expect(shouldNotify(prefs, 'comment_created', 'inApp')).toBe(true)
    // push is unaffected by the legacy email-only boolean
    expect(shouldNotify(prefs, 'comment_created', 'push')).toBe(true)
  })

  it('respects the legacy emailStatusChange=false override for post_status_changed+email', () => {
    const prefs: NotificationPreferencesData = { ...basePrefs, emailStatusChange: false }
    expect(shouldNotify(prefs, 'post_status_changed', 'email')).toBe(false)
    expect(shouldNotify(prefs, 'post_status_changed', 'inApp')).toBe(true)
  })

  it('legacy booleans do not leak into unrelated types', () => {
    const prefs: NotificationPreferencesData = {
      ...basePrefs,
      emailNewComment: false,
      emailStatusChange: false,
    }
    expect(shouldNotify(prefs, 'post_mentioned', 'email')).toBe(true)
    expect(shouldNotify(prefs, 'chat_message', 'email')).toBe(true)
  })

  it('emailMuted kills email and push for all types but never inApp', () => {
    const prefs: NotificationPreferencesData = { ...basePrefs, emailMuted: true }
    expect(shouldNotify(prefs, 'comment_created', 'email')).toBe(false)
    expect(shouldNotify(prefs, 'comment_created', 'push')).toBe(false)
    expect(shouldNotify(prefs, 'comment_created', 'inApp')).toBe(true)

    expect(shouldNotify(prefs, 'post_status_changed', 'email')).toBe(false)
    expect(shouldNotify(prefs, 'post_mentioned', 'email')).toBe(false)
    expect(shouldNotify(prefs, 'assistant_handed_off', 'push')).toBe(false)
    expect(shouldNotify(prefs, 'assistant_handed_off', 'inApp')).toBe(true)
  })

  it('an explicit matrix entry overrides the legacy boolean', () => {
    const prefs: NotificationPreferencesData = {
      ...basePrefs,
      emailNewComment: false,
      matrix: { comment_created: { email: true } },
    }
    expect(shouldNotify(prefs, 'comment_created', 'email')).toBe(true)
  })

  it('an explicit matrix entry overrides the default for a type with no legacy mapping', () => {
    const prefs: NotificationPreferencesData = {
      ...basePrefs,
      matrix: { post_mentioned: { inApp: false } },
    }
    expect(shouldNotify(prefs, 'post_mentioned', 'inApp')).toBe(false)
    // untouched channels on the same type still fall through to default
    expect(shouldNotify(prefs, 'post_mentioned', 'email')).toBe(true)
  })

  it('explicit matrix false is not overridden by emailMuted precedence (emailMuted still wins for email/push)', () => {
    const prefs: NotificationPreferencesData = {
      ...basePrefs,
      emailMuted: true,
      matrix: { comment_created: { email: true } },
    }
    // emailMuted is checked first and short-circuits email/push regardless of matrix
    expect(shouldNotify(prefs, 'comment_created', 'email')).toBe(false)
  })

  it('unknown/new types with no matrix entry default to true, still subject to emailMuted', () => {
    expect(shouldNotify(basePrefs, 'conversation_assigned', 'inApp')).toBe(true)
    expect(shouldNotify(basePrefs, 'conversation_assigned', 'email')).toBe(true)
    expect(shouldNotify(basePrefs, 'conversation_assigned', 'push')).toBe(true)

    const muted: NotificationPreferencesData = { ...basePrefs, emailMuted: true }
    expect(shouldNotify(muted, 'ticket_assigned', 'email')).toBe(false)
    expect(shouldNotify(muted, 'ticket_assigned', 'push')).toBe(false)
    expect(shouldNotify(muted, 'ticket_assigned', 'inApp')).toBe(true)
  })
})
