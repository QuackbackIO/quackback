/**
 * Which one-time-code endpoint runs `hooks.before`, asked of the real library.
 *
 * `requestEmailSignin` mints a code for an address it has already decided
 * about, having spent the sign-in budget for that decision at its caller. If
 * the mint re-enters `hooks.before` it spends that budget a second time, and
 * the two worlds the caller works to keep indistinguishable stop costing the
 * same: the allowed answer runs out of budget sooner than the refused one, and
 * the second spend arrives as an exception thrown from the middle of a request
 * that had already passed its own check.
 *
 * `mintMagicLinkUrl` avoids that by writing its verification row through the
 * internal adapter rather than through the endpoint. The code half has the same
 * option, because Better-Auth's email-OTP plugin exposes two endpoints that
 * both create the row: `sendVerificationOTP`, which is routed at
 * `/email-otp/send-verification-otp` and is therefore user-facing and hooked,
 * and `createVerificationOTP`, which is declared with no path at all and
 * returns the code to its caller instead of handing it to the send callback.
 *
 * That difference is a fact about an installed dependency, so it is asserted
 * against the dependency rather than described in a comment. A real auth
 * instance, a real recording `hooks.before`, and both endpoints called in turn.
 * If a future version routes the second endpoint, this fails and the mint has
 * to move again.
 *
 * The path a path-less endpoint reaches the chain with is `'/'`, not
 * `undefined` — Better-Auth's dispatcher substitutes a placeholder. It is the
 * kind of detail that reads either way in a docstring, which is the reason to
 * ask the library instead of reasoning about it: what matters is only that the
 * value is not one `inferProvider` recognises, and `'/'` is not.
 *
 * The adapter is Better-Auth's own in-memory one: nothing here is about
 * storage, and a database would only add a way for this to fail for an
 * unrelated reason.
 */
import { describe, it, expect } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { emailOTP } from 'better-auth/plugins'
import { createAuthMiddleware } from 'better-auth/api'

const EMAIL = 'someone@acme.example'

/** Paths `hooks.before` saw, in order. */
const seen: Array<string | undefined> = []

const auth = betterAuth({
  baseURL: 'https://acme.quackback.io',
  secret: 'test-secret-not-used-for-anything-real',
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  emailAndPassword: { enabled: true },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      seen.push(ctx.path)
    }),
  },
  plugins: [
    emailOTP({
      async sendVerificationOTP() {
        // Nothing to do: what this suite observes is the hook, not the send.
      },
      otpLength: 6,
      expiresIn: 600,
    }),
  ],
})

describe('the email-OTP endpoints and the before-hook chain', () => {
  it('runs the chain for the routed send endpoint, and skips it for the path-less mint', async () => {
    seen.length = 0
    await auth.api.sendVerificationOTP({ body: { email: EMAIL, type: 'sign-in' } })
    const afterSend = [...seen]

    seen.length = 0
    const code = await auth.api.createVerificationOTP({ body: { email: EMAIL, type: 'sign-in' } })
    const afterCreate = [...seen]

    // The routed endpoint is seen by the chain, under the exact template
    // `inferProvider` maps onto the magic-link rate limiter.
    expect(afterSend).toEqual(['/email-otp/send-verification-otp'])

    // The mint reaches the chain under the placeholder path, which
    // `inferProvider` does not recognise — so `handleSignInPreCheck` returns
    // before it reaches a rate limiter or any other gate.
    expect(afterCreate).toEqual(['/'])
    const { inferProvider } = await import('../hooks')
    expect(inferProvider({ path: '/' })).toBeNull()

    // And it really did mint: a six-digit code came back, so "no path" is not
    // "no work".
    expect(code).toMatch(/^\d{6}$/)
  })

  // The row the verify path redeems. Without this, "it minted" rests on the
  // return value alone, which a plugin could produce without storing anything.
  it('leaves a redeemable verification row behind', async () => {
    const code = await auth.api.createVerificationOTP({ body: { email: EMAIL, type: 'sign-in' } })
    const stored = await auth.api.getVerificationOTP({ query: { email: EMAIL, type: 'sign-in' } })

    expect(stored.otp).toBe(code)
  })
})
