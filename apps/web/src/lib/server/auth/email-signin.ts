import { getAuth } from './index'
import { mintMagicLinkUrl } from './magic-link-mint'
import { isAccountCreationAllowed } from './signup-policy'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'auth-email-signin' })

/**
 * Sends a passwordless sign-in email containing both a magic-link button
 * and a 6-digit code. Either path consumes a verification record on the
 * server, so the user picks whichever fits their context (desktop click,
 * cross-device code entry, link-eaten-by-Outlook fallback).
 *
 * ## Why this returns nothing, ever, whatever the answer
 *
 * A workspace that has closed sign-ups refuses to open an account for an
 * address no user row and no invitation covers. That refusal must not reach
 * the caller: this endpoint takes an arbitrary address from an unauthenticated
 * request, so an answer that varied with the address would tell anybody who
 * asked which addresses hold accounts here, and which have been invited and
 * not yet joined. Two visible behaviours, one bit of the workspace's private
 * state, no session required.
 *
 * So both worlds do the same amount of the same kind of work and end the same
 * way: read the workspace, decide, send exactly one email, return. The refused
 * address gets {@link sendSignupNotAllowedEmail} instead of a sign-in link —
 * the inbox is the only channel that reaches nobody but the person the answer
 * is about, and that message grants nothing, so mailing it to an address
 * nobody has proven they own gives nothing away.
 *
 * Metering belongs to the caller (`routes/api/auth/portal-signin.ts`), before
 * this is entered, so that both worlds cost an attacker the same budget. That
 * only holds if nothing in here spends it again — see the mint below.
 */
export async function requestEmailSignin(opts: {
  email: string
  /** Path the user lands on after a successful magic-link click. */
  callbackURL: string
}): Promise<void> {
  const auth = await getAuth()

  const { db } = await import('@/lib/server/db')
  const { isEmailConfigured, sendMagicLinkEmail, sendSignupNotAllowedEmail } =
    await import('@quackback/email')
  const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')

  // Read before the branch, not inside it: both outcomes mail something, and
  // both mail it with this workspace's branding.
  const settings = await db.query.settings.findFirst({ columns: { name: true, logoKey: true } })
  const logoUrl = getEmailSafeUrl(settings?.logoKey) ?? undefined

  // `openSignup`, in front of the mint rather than around it.
  //
  // `mintMagicLinkUrl` deliberately does not run the `hooks.before` chain, and
  // the two halves below are issued together: a refusal on the OTP half, which
  // does run that chain, would reject the request while leaving a working
  // sign-in link already written to the verification table. So the only place
  // this can be decided for this path is here, before either half starts.
  //
  // The PORTAL door, including when `callbackURL` points at `/admin`. What this
  // path can bring into existence is a portal account — `user.create.after`
  // writes `role: 'user'` and consults nothing — so the portal's answer is the
  // one that governs it, and branching on the callback would only let a caller
  // pick which of the workspace's two answers to be judged by.
  if (!(await isAccountCreationAllowed(opts.email, 'portal'))) {
    // Domain only, never the address: an operator reading a log must not be
    // able to read back who tried to sign in.
    log.info(
      { email_domain: opts.email.split('@')[1] ?? null },
      'sign-in refused: workspace is not accepting new accounts'
    )
    if (!isEmailConfigured()) return
    const { typedAddressRecipient } = await import('@/lib/server/email/recipient')
    const to = typedAddressRecipient(opts.email)
    if (!to) return
    await sendSignupNotAllowedEmail({
      to,
      workspaceName: settings?.name ?? undefined,
      logoUrl,
    })
    return
  }

  // Failed verifies (token consumed by an email scanner, expired, etc.)
  // need to land on the right login page. Admin callbacks (`/admin/...`)
  // bounce to the unified login with a `/admin` callback so it renders
  // the team break-glass form and can request a replacement link. Better-
  // Auth merges its `error` param onto this URL via `URL.searchParams`,
  // so the existing `?callbackUrl=` query survives (joined with `&`).
  // Portal callbacks fall back to /auth/login (the public login screen).
  const errorCallbackPath = opts.callbackURL.startsWith('/admin')
    ? '/auth/login?callbackUrl=/admin'
    : '/auth/login'

  // Both halves are minted, neither is sent from here.
  //
  // `createVerificationOTP` rather than `sendVerificationOTP`, for the same
  // reason `mintMagicLinkUrl` writes its row through the internal adapter:
  // `auth.api.*` dispatches through the `hooks.before` chain, and this app's
  // link in that chain spends the sign-in rate-limit budget. The caller has
  // already spent it once for this request — deliberately, before it knew the
  // answer, so that a refused address and an accepted one cost the same — and a
  // second spend here made the accepted world twice as expensive as the refused
  // one. That is the enumeration difference back again, read off how many
  // requests each address survives instead of off any one response, and it also
  // meant a real user's second attempt inside the window died on an exception
  // thrown from the middle of a request that had passed its own check.
  //
  // The path-less endpoint has no such chain to re-enter, creates the same
  // verification row, and returns the code instead of routing it through the
  // plugin's send callback. `auth/__tests__/otp-endpoint-hooks.test.ts` holds
  // that claim against the installed library.
  const [minted, otp] = await Promise.all([
    mintMagicLinkUrl({
      email: opts.email,
      callbackPath: opts.callbackURL,
      errorCallbackPath,
      portalUrl: config.baseUrl,
    }),
    auth.api.createVerificationOTP({
      body: { email: opts.email, type: 'sign-in' },
    }),
  ])

  if (!otp) throw new Error('OTP was not minted')

  if (!isEmailConfigured()) {
    log.warn('sign-in email not sent: email transport is not configured')
    return
  }

  // Sealed class: mail the address the verification row was minted for, not the
  // request string. There is no account to look up — this may be a signup — so
  // "the address IS the claim" is the only rule available, and it is a stronger
  // one than a lookup would give.
  const { sealedRecipient } = await import('@/lib/server/email/recipient')
  await sendMagicLinkEmail({
    to: sealedRecipient(minted),
    signInUrl: minted.url,
    code: otp,
    logoUrl,
  })
}
