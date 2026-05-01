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

  return buildVerifyMagicLinkUrl({
    origin: opts.portalUrl,
    token,
    callbackPath: opts.callbackPath,
    errorCallbackPath: opts.errorCallbackPath,
  })
}
