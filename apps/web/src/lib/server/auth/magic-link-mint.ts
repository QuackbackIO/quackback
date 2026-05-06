import { getAuth, getMagicLinkToken } from './index'

interface MintOptions {
  email: string
  /** Path the user lands on after a successful verify. */
  callbackPath: string
  /** Path on a failed verify (token consumed by an email scanner, expired, etc.).
   * Defaults to `callbackPath`. New callers should point at `/admin/login`
   * so failed clicks don't double-bounce through a deep route guard. */
  errorCallbackPath?: string
  /** Workspace's public origin, e.g. `https://acme.quackback.io`. */
  portalUrl: string
  /** Override the default 10-minute expiry on the underlying verification
   *  row. Used by the cloud-bootstrap "claim this workspace" URL which
   *  needs a multi-day window. Sign-in callers (portal/admin) must NOT
   *  set this — the global plugin expiry is intentionally short. */
  expiresInSeconds?: number
}

/** Build the `/verify-magic-link?token=…&callbackURL=…&errorCallbackURL=…` URL. */
export function buildVerifyMagicLinkUrl(opts: {
  origin: string
  token: string
  callbackPath: string
  errorCallbackPath?: string
}): string {
  const url = new URL('/verify-magic-link', opts.origin)
  url.searchParams.set('token', opts.token)
  url.searchParams.set('callbackURL', `${opts.origin}${opts.callbackPath}`)
  url.searchParams.set(
    'errorCallbackURL',
    `${opts.origin}${opts.errorCallbackPath ?? opts.callbackPath}`
  )
  return url.toString()
}

/**
 * Mints a verify URL that signs the recipient in on click. Used by team
 * invitations and Cloud bootstrap; callers email their own template.
 * Portal sign-in (combined magic-link + OTP) goes through `email-signin.ts`.
 */
export async function mintMagicLinkUrl(opts: MintOptions): Promise<string> {
  const auth = await getAuth()

  // auth.api.signInMagicLink fires the magicLink plugin callback, which
  // stashes the token; we drain it via getMagicLinkToken.
  await auth.api.signInMagicLink({
    body: { email: opts.email, callbackURL: opts.callbackPath },
    headers: new Headers({
      Origin: opts.portalUrl,
      Host: new URL(opts.portalUrl).host,
    }),
  })

  const token = getMagicLinkToken(opts.email)
  if (!token) {
    throw new Error('Magic link token not captured — sendMagicLink callback may not have fired')
  }

  if (opts.expiresInSeconds && opts.expiresInSeconds > 60 * 10) {
    await extendVerificationExpiry(token, opts.expiresInSeconds)
  }

  return buildVerifyMagicLinkUrl({
    origin: opts.portalUrl,
    token,
    callbackPath: opts.callbackPath,
    errorCallbackPath: opts.errorCallbackPath,
  })
}

/**
 * Better-Auth's magicLink plugin has a single global expiresIn (10 min,
 * sized for sign-in safety). Bootstrap's claim URL needs a longer window;
 * push the verification row's expires_at out to the requested TTL after
 * the token is minted. The verify endpoint reads expires_at from this
 * row directly, so this is sufficient — no token re-signing required.
 */
async function extendVerificationExpiry(token: string, expiresInSeconds: number): Promise<void> {
  const { db } = await import('@/lib/server/db')
  const { verification } = await import('@/lib/server/db')
  const { eq } = await import('drizzle-orm')
  const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000)
  // Better-Auth stores the magic-link record keyed on `value=token`.
  await db
    .update(verification)
    .set({ expiresAt: newExpiresAt })
    .where(eq(verification.value, token))
}
