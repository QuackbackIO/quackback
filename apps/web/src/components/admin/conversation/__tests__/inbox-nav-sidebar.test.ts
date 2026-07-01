/**
 * The URL view allowlist must track the canonical CONVERSATION_VIEWS list so a
 * deep-link like ?view=saved can't be silently dropped. Regression: the inbox
 * route's validateSearch hard-coded the allowlist and forgot 'saved', so
 * clicking "Saved for later" fell back to the conversation list.
 */
import { describe, expect, it } from 'vitest'
import { CONVERSATION_VIEWS, isInboxView } from '../inbox-nav-sidebar'

describe('isInboxView', () => {
  it('accepts every canonical conversation view', () => {
    for (const { view } of CONVERSATION_VIEWS) {
      expect(isInboxView(view)).toBe(true)
    }
  })

  it('accepts "saved" — the per-agent Saved for later view', () => {
    expect(isInboxView('saved')).toBe(true)
  })

  it('rejects unknown and non-string values', () => {
    expect(isInboxView('bogus')).toBe(false)
    expect(isInboxView(undefined)).toBe(false)
    expect(isInboxView(42)).toBe(false)
  })
})
