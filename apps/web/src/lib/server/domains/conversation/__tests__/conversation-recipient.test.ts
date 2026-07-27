import { describe, it, expect } from 'vitest'
import { resolveReplyRecipient } from '../conversation.recipient'

describe('resolveReplyRecipient', () => {
  it('prefers an identified visitor account email above all', () => {
    expect(
      resolveReplyRecipient({ type: 'user', email: 'a@b.com' }, 'contact@x.com', 'captured@x.com')
    ).toBe('a@b.com')
  })

  it('uses the principal contact email before the per-conversation captured one', () => {
    expect(
      resolveReplyRecipient({ type: 'anonymous', email: null }, 'contact@x.com', 'captured@x.com')
    ).toBe('contact@x.com')
  })

  it('falls back to the captured pre-chat email when no contact email is on file', () => {
    expect(resolveReplyRecipient({ type: 'anonymous', email: null }, null, 'captured@x.com')).toBe(
      'captured@x.com'
    )
  })

  it('falls back past an identified account with no email on record', () => {
    expect(resolveReplyRecipient({ type: 'user', email: null }, 'contact@x.com', null)).toBe(
      'contact@x.com'
    )
  })

  it('returns null when there is no reachable address', () => {
    expect(resolveReplyRecipient({ type: 'anonymous', email: null }, null, null)).toBeNull()
    expect(resolveReplyRecipient(undefined, undefined, undefined)).toBeNull()
  })

  it('falls past a placeholder account address to the contact email', () => {
    // A provider that releases no email gets a minted placeholder on the
    // account. It is non-null, so a truthiness check hands it back as the
    // recipient and the transport then silently drops the send — the agent
    // sees a reply that was never delivered.
    expect(
      resolveReplyRecipient(
        { type: 'user', email: 'sso-oidc-01j9-abc@anon.quackback.io' },
        'real@x.com',
        null
      )
    ).toBe('real@x.com')
  })

  it('returns null rather than a placeholder when nothing real is on file', () => {
    expect(
      resolveReplyRecipient(
        { type: 'user', email: 'sso-oidc-01j9-abc@anon.quackback.io' },
        null,
        null
      )
    ).toBeNull()
  })
})
