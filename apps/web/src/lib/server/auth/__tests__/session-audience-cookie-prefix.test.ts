import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({ config: { authCookiePrefix: 'feedback' } }))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({ getClientIp: () => '203.0.113.1' }))

import { isStrandedPortalSession } from '../session-audience'

const anonymous = { session: { id: 'session', scope: 'widget' }, user: { isAnonymous: true } }

describe('portal audience cookie namespace', () => {
  it.each(['feedback.session_token', '__Secure-feedback.session_token'])(
    'recognises the configured cookie %s for anonymous portal healing',
    (name) => {
      expect(isStrandedPortalSession(anonymous, new Headers({ cookie: `${name}=own.sig` }))).toBe(
        true
      )
    }
  )

  it('does not heal sessions presented through another app cookie or a widget Bearer', () => {
    for (const cookie of [
      'better-auth.session_token=other.sig',
      '__Secure-better-auth.session_token=other.sig',
    ]) {
      expect(isStrandedPortalSession(anonymous, new Headers({ cookie }))).toBe(false)
    }
    expect(
      isStrandedPortalSession(
        anonymous,
        new Headers({
          cookie: '__Secure-feedback.session_token=own.sig',
          authorization: 'Bearer widget-token',
        })
      )
    ).toBe(false)
  })
})
