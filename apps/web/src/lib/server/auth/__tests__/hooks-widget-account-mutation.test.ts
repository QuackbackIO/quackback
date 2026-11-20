/**
 * Widget Bearers must not hit Better Auth's mounted account-mutation
 * endpoints. `emailOTP.changeEmail` has verifyCurrentEmail: false, so the
 * current-address proof in contact-email.ts is skipped on these paths.
 */
import { describe, expect, it, vi } from 'vitest'
import { APIError } from 'better-auth/api'

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: {} },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(),
  getPublicPortalConfig: vi.fn(),
}))

vi.mock('@/lib/server/auth/signin-rate-limit', () => ({
  checkCredentialSignInRateLimit: vi.fn(),
  checkMagicLinkSendRateLimit: vi.fn(),
}))

vi.mock('@/lib/server/auth/widget-rate-limit', () => ({
  checkAnonMintRateLimit: vi.fn(),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/bootstrap-admin', () => ({
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
  isSetupOpenToClaim: vi.fn(async () => true),
  // Nobody has claimed setup by creating an account; that claim is covered
  // against real Postgres.
  findSetupClaimant: async () => undefined,
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(),
}))

vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: vi.fn(),
}))

const { handleWidgetAccountMutationGate } = await import('../hooks')

function ctx(opts: { path: string; token?: string; cookie?: string; scope?: string | null }) {
  const headers = new Headers()
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
  if (opts.cookie) headers.set('cookie', opts.cookie)
  return {
    path: opts.path,
    headers,
    context: {
      internalAdapter: {
        findSession: vi.fn(async (token: string): Promise<{ session: object } | null> => {
          if (opts.scope === null) return null
          if (opts.token && token !== opts.token.split('.')[0]) return null
          return { session: { scope: opts.scope } }
        }),
      },
    },
  }
}

describe('handleWidgetAccountMutationGate', () => {
  it('rejects a widget Bearer on request-email-change', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/request-email-change', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toBeInstanceOf(APIError)
  })

  it('rejects a widget Bearer on change-email OTP confirm', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/change-email', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('allows a portal-scoped Bearer so handoff customers can still change email', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/request-email-change', token: 'portal-tok', scope: 'portal' })
      )
    ).resolves.toBeUndefined()
  })

  it('allows a dashboard-scoped Bearer', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/change-email', token: 'dash-tok', scope: 'dashboard' })
      )
    ).resolves.toBeUndefined()
  })

  it('rejects a widget Bearer on session-revocation routes', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/revoke-sessions', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/revoke-other-sessions', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('rejects a widget Bearer on OAuth account-link routes', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/link-social', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/oauth2/link', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('allows widget Bearers on the session/OTT allowlist', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/get-session', token: 'widget-tok', scope: 'widget' })
      )
    ).resolves.toBeUndefined()
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/one-time-token/generate', token: 'widget-tok', scope: 'widget' })
      )
    ).resolves.toBeUndefined()
  })

  it.each([
    '/get-session',
    '/sign-in/anonymous',
    '/one-time-token/generate',
    '/one-time-token/verify',
  ])('refuses test credentials on %s before any cookie-setting hook', async (path) => {
    const c = ctx({
      path,
      token: 'customer-session-00000000-0000-0000-0000-000000000000',
      scope: 'widget',
    })
    await expect(handleWidgetAccountMutationGate(c)).rejects.toThrow(/test session/i)
    expect(c.context.internalAdapter.findSession).not.toHaveBeenCalled()
  })

  it('skips the session lookup on allowlisted paths, whatever the credential', async () => {
    // `/get-session` runs on every authenticated request; the allowlist
    // decides the outcome there, so reading the session first is wasted work.
    for (const path of ['/get-session', '/sign-in/anonymous', '/one-time-token/verify']) {
      for (const creds of [
        { token: 'widget-tok', scope: 'widget' },
        { cookie: 'better-auth.session_token=dash-tok.sig', scope: 'dashboard' },
      ]) {
        const c = ctx({ path, ...creds })
        await expect(handleWidgetAccountMutationGate(c)).resolves.toBeUndefined()
        expect(c.context.internalAdapter.findSession).not.toHaveBeenCalled()
      }
    }
  })

  it('still looks the session up on a gated path', async () => {
    const c = ctx({
      path: '/update-user',
      cookie: 'better-auth.session_token=dash-tok.sig',
      scope: 'dashboard',
    })
    await expect(handleWidgetAccountMutationGate(c)).resolves.toBeUndefined()
    expect(c.context.internalAdapter.findSession).toHaveBeenCalledWith('dash-tok')
  })

  it('rejects a widget Bearer on any other Better Auth path', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/sign-out', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  // A session pending two-factor enrolment may finish enrolment or sign out;
  // a one-time token would trade it for an ordinary session.
  it('holds a session pending two-factor enrolment to enrolment and sign-out', async () => {
    const pending = (path: string) => {
      const c = ctx({ path, cookie: 'better-auth.session_token=pend-tok.sig', scope: 'portal' })
      c.context.internalAdapter.findSession.mockResolvedValue({
        session: { scope: 'portal', twoFactorPending: true },
      })
      return c
    }
    for (const path of ['/one-time-token/generate', '/update-user', '/list-sessions']) {
      await expect(handleWidgetAccountMutationGate(pending(path))).rejects.toThrow(/two-factor/)
    }
    // Enrolment, sign-out, and starting over: signing in again, or resetting
    // the password, never act on the session already held.
    for (const path of [
      '/two-factor/enable',
      '/two-factor/verify-totp',
      '/sign-out',
      '/sign-in/email',
      '/sign-in/email-otp',
      '/request-password-reset',
    ]) {
      await expect(handleWidgetAccountMutationGate(pending(path))).resolves.toBeUndefined()
    }
  })

  // On https the library names the cookie `__Secure-better-auth.session_token`.
  it('reads the session from the secure cookie name too', async () => {
    const pending = ctx({
      path: '/update-user',
      cookie: '__Secure-better-auth.session_token=pend-tok.sig',
      scope: 'portal',
    })
    pending.context.internalAdapter.findSession.mockResolvedValue({
      session: { scope: 'portal', twoFactorPending: true },
    })
    await expect(handleWidgetAccountMutationGate(pending)).rejects.toThrow(/two-factor/)
    expect(pending.context.internalAdapter.findSession).toHaveBeenCalledWith('pend-tok')

    await expect(
      handleWidgetAccountMutationGate(
        ctx({
          path: '/update-user',
          cookie: '__Secure-better-auth.session_token=widget-tok.sig',
          scope: 'widget',
        })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  // The gate cannot know which credential the library will use, so every
  // one sent must pass: a decoy in front of the real session is no way past.
  describe('with more than one credential on the request', () => {
    const sessions: Record<string, { session: { scope: string; twoFactorPending?: boolean } }> = {
      'pend-tok': { session: { scope: 'portal', twoFactorPending: true } },
      'widget-tok': { session: { scope: 'widget' } },
      'dash-tok': { session: { scope: 'dashboard' } },
    }
    function many(headers: Record<string, string>) {
      return {
        path: '/update-user',
        headers: new Headers(headers),
        context: {
          internalAdapter: {
            findSession: vi.fn(async (token: string) => sessions[token] ?? null),
          },
        },
      }
    }

    it.each([
      [
        'a junk Bearer in front of a secure pending cookie',
        {
          authorization: 'Bearer junk.x',
          cookie: '__Secure-better-auth.session_token=pend-tok.sig',
        },
      ],
      [
        'a plain decoy cookie in front of a secure pending cookie',
        {
          cookie:
            'better-auth.session_token=x.sig; __Secure-better-auth.session_token=pend-tok.sig',
        },
      ],
      [
        'an ordinary Bearer in front of a pending cookie',
        { authorization: 'Bearer dash-tok.sig', cookie: 'better-auth.session_token=pend-tok.sig' },
      ],
    ])('refuses %s', async (_label, headers) => {
      await expect(handleWidgetAccountMutationGate(many(headers))).rejects.toThrow(/two-factor/)
    })

    it('refuses a widget session behind a decoy cookie', async () => {
      await expect(
        handleWidgetAccountMutationGate(
          many({
            cookie:
              'better-auth.session_token=x.sig; __Secure-better-auth.session_token=widget-tok.sig',
          })
        )
      ).rejects.toThrow(/Widget sessions/)
    })

    it('lets an ordinary session through with a decoy beside it (the control)', async () => {
      await expect(
        handleWidgetAccountMutationGate(
          many({ authorization: 'Bearer junk.x', cookie: 'better-auth.session_token=dash-tok.sig' })
        )
      ).resolves.toBeUndefined()
    })
  })

  it('no-ops when there is no session token', async () => {
    await expect(
      handleWidgetAccountMutationGate(ctx({ path: '/change-email' }))
    ).resolves.toBeUndefined()
  })
})
