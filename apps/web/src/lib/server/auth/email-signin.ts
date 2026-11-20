import { getAuth } from './index'
import { mintMagicLinkUrl } from './magic-link-mint'
import { isAccountCreationAllowed } from './signup-policy'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { isSafeCallbackUrl, isTeamCallback } from '@/lib/shared/routing'
import { normalizeMethodKey } from '@/lib/shared/signin-methods'

const log = logger.child({ component: 'auth-email-signin' })

/**
 * A refusal the caller may report as-is. Only for answers that depend on the
 * address's DOMAIN and on workspace configuration, never on whether an account
 * exists: "Require SSO" on a verified domain is already visible to anyone who
 * types an address there, because the sign-in form routes the domain to its
 * provider, and the "Email magic link" method being off is visible to anyone
 * who opens the sign-in form. Account-dependent refusals stay silent (see
 * below).
 */
export class EmailSigninRefusedError extends Error {
  constructor(readonly code: 'verified_domain_requires_sso' | 'magic_link_method_not_allowed') {
    super(code)
    this.name = 'EmailSigninRefusedError'
  }
}

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
  /**
   * The origin the link signs in on, when the sign-in started on a section
   * host (https://help.acme.com): sessions are host-only, so the link must
   * land where the visitor is. The caller vouches for it; absent, the
   * primary domain.
   */
  linkOrigin?: string
}): Promise<void> {
  // "Require SSO", in front of the mint. The link minted below is redeemed at
  // `/magic-link/verify`, whose address travels inside the token, so the
  // hook layer that enforces this for every other email path never sees it.
  // Same rule and same owner-scoped fail-open as `hooks.before`.
  const { loadSsoDomains } = await import('./sso-managed-email')
  const { isHardBound } = await import('./auth-restrictions')
  const { providers, registered } = await loadSsoDomains()
  if (isHardBound('magic-link', opts.email, providers, registered)) {
    throw new EmailSigninRefusedError('verified_domain_requires_sso')
  }

  // The link lands on `${origin}${callbackPath}`, so only a same-origin path
  // may ride in it ("@evil.example" or ".evil.example" would change the host).
  const callbackPath = isSafeCallbackUrl(opts.callbackURL) ? opts.callbackURL : '/'

  // The "Email magic link" method, in front of the mint for the same reason as
  // "Require SSO" above: nothing downstream runs the hook layer that enforces
  // it for every other email path. One predicate with that layer, so email
  // links that stand in while single sign-on is paused stay in force here too.
  const { isAuthMethodAllowed } = await import('./auth-restrictions')
  const methodInForce = (await isAuthMethodAllowed('magic-link', 'user', registered)).allowed
  if (!methodInForce) {
    // The one email that survives the method being off: the confirmation that
    // lets an existing account link a provider sign-in (see
    // `isLinkConflictConfirmation`). Anything else is refused, the same way for
    // every address.
    if (!linkConflictProvider(callbackPath)) {
      throw new EmailSigninRefusedError('magic_link_method_not_allowed')
    }
    if (!(await isLinkConflictConfirmation(opts.email, callbackPath, registered))) {
      // Answered exactly as a send is, so asking says nothing about the
      // address; the confirmation is only ever mailed to an account's owner.
      log.info(
        { email_domain: opts.email.split('@')[1] ?? null },
        'link confirmation not sent: no account, or the provider is not in force'
      )
      return
    }
  }

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
  // need to land on the right login page. Team callbacks (`/admin/...`)
  // bounce to the unified login carrying the same deep link so it renders
  // the team form and, once signed in, returns there. Better-Auth merges its
  // `error` param onto this URL via `URL.searchParams`, so the existing
  // `?callbackUrl=` query survives (joined with `&`). Portal callbacks fall
  // back to /auth/login (the public login screen).
  const errorCallbackPath = isTeamCallback(callbackPath)
    ? `/auth/login?${new URLSearchParams({ callbackUrl: callbackPath }).toString()}`
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
      callbackPath,
      errorCallbackPath,
      portalUrl: opts.linkOrigin ?? config.baseUrl,
      // A link the method governs, so the verify side can refuse it once the
      // method is off. The link-conflict confirmation, sent while the method
      // is off, is not one.
      purpose: methodInForce ? 'email-signin' : undefined,
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
    workspaceName: settings?.name ?? undefined,
  })
}

/**
 * The provider a link-conflict confirmation would resume, read from the
 * callback the dialog sends (`/auth/link-sso?provider=…`), or null when the
 * callback is not one. Email and password are never providers here: linking
 * one of them is not what `/auth/link-sso` resumes.
 */
function linkConflictProvider(callbackPath: string): string | null {
  const url = new URL(callbackPath, 'http://callback.invalid')
  if (url.pathname !== '/auth/link-sso') return null
  const provider = url.searchParams.get('provider')
  if (!provider) return null
  const key = normalizeMethodKey(provider)
  return key === 'password' || key === 'magicLink' ? null : provider
}

/**
 * Whether this request is the link-conflict confirmation, which is sent even
 * while the "Email magic link" method is off.
 *
 * A provider sign-in that lands on an address an account already holds is
 * refused with `account_not_linked` until the account proves the address; the
 * dialog then mails the account a sign-in link that resumes the provider link
 * at `/auth/link-sso`. Refusing it with the method off would leave such an
 * account no way to connect its provider.
 *
 * The callback is chosen by the caller, so it is not trusted on its own: the
 * address must hold an account, and the provider named must be one this
 * workspace signs people in with right now. Even so, the holder of an existing
 * account can get a sign-in link this way while the method is off, by asking
 * for the confirmation; the link reaches only that account's inbox.
 */
async function isLinkConflictConfirmation(
  email: string,
  callbackPath: string,
  registered: Set<string>
): Promise<boolean> {
  const provider = linkConflictProvider(callbackPath)
  if (!provider) return false
  const { isAuthMethodAllowed } = await import('./auth-restrictions')
  if (!(await isAuthMethodAllowed(provider, 'user', registered)).allowed) return false
  const { db, user, eq } = await import('@/lib/server/db')
  const account = await db.query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true },
  })
  return !!account
}
