import { describe, it, expect } from 'vitest'
import { parseInvitationId } from '../parse-invitation-id'

describe('parseInvitationId', () => {
  it('recognizes team signup callbacks', () => {
    expect(parseInvitationId('https://acme.test/complete-signup/invite_abc123')).toBe(
      'invite_abc123'
    )
  })

  it('recognizes portal invite callbacks', () => {
    expect(parseInvitationId('https://acme.test/portal-invite/invite_abc123')).toBe('invite_abc123')
  })

  it('ignores ordinary magic-link callbacks', () => {
    expect(parseInvitationId('https://acme.test/auth/login')).toBeNull()
  })

  it('returns null for missing or unparseable input', () => {
    expect(parseInvitationId(undefined)).toBeNull()
    expect(parseInvitationId('not a url')).toBeNull()
  })

  it('reads the id from a full magic-link callbackURL with query string', () => {
    expect(
      parseInvitationId('https://acme.test/portal-invite/invite_abc123?error=INVALID_TOKEN')
    ).toBe('invite_abc123')
  })
})
