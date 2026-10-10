/**
 * The email-change endpoints are closed to HTTP and still callable in process,
 * asked of the real library.
 *
 * `functions/contact-email.ts` proves the current address and applies the
 * domain rules before it calls these endpoints through `auth.api.*`. Routed,
 * they need only a session, so a request straight to them skipped all of that.
 * Closing them relies on one fact about the installed dependency: that
 * `disabledPaths` is enforced by the HTTP router and not by the endpoint, so
 * in-process calls still reach the handler. That is asserted here rather than
 * described, so a version that moves the check fails this instead of quietly
 * breaking the email change.
 */
import { describe, it, expect } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { emailOTP } from 'better-auth/plugins'
import { HTTP_DISABLED_AUTH_PATHS } from '../http-disabled-paths'

const ORIGIN = 'https://acme.quackback.io'

const auth = betterAuth({
  baseURL: ORIGIN,
  secret: 'test-secret-not-used-for-anything-real',
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  emailAndPassword: { enabled: true },
  disabledPaths: HTTP_DISABLED_AUTH_PATHS,
  plugins: [
    emailOTP({
      async sendVerificationOTP() {},
      otpLength: 6,
      expiresIn: 600,
      changeEmail: { enabled: true, verifyCurrentEmail: false },
    }),
  ],
})

function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  })
}

describe('email-change endpoints', () => {
  it.each(['/email-otp/request-email-change', '/email-otp/change-email'])(
    'answers 404 to an HTTP request for %s',
    async (path) => {
      const res = await auth.handler(post(path, { newEmail: 'new@example.com', otp: '123456' }))

      expect(res.status).toBe(404)
    }
  )

  // The control: the same router still serves a sibling path, so the 404s
  // above are the disabled list and not a wrong base path.
  it('still serves a sibling email-OTP path over HTTP', async () => {
    const res = await auth.handler(
      post('/email-otp/send-verification-otp', { email: 'someone@example.com', type: 'sign-in' })
    )

    expect(res.status).not.toBe(404)
  })

  // In process the endpoint runs: with no session it refuses as unauthorized,
  // which only the handler itself can say.
  it('still reaches the handler in process', async () => {
    await expect(
      auth.api.requestEmailChangeEmailOTP({ body: { newEmail: 'new@example.com' } })
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' })
  })
})
