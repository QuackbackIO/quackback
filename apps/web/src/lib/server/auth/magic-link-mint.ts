import { generateRandomString } from 'better-auth/crypto'
import { getAuth } from './index'

interface MintOptions {
  email: string
  /** Path the user lands on after a successful verify. */
  callbackPath: string
  /** Path on a failed verify. Defaults to `callbackPath`. */
  errorCallbackPath?: string
  /** Workspace's public origin, e.g. `https://acme.quackback.io`. */
  portalUrl: string
  /** Override the default 10-minute expiry. Used by long-lived
   *  "claim this workspace" invitations. */
  expiresInSeconds?: number
}

const DEFAULT_EXPIRES_IN_SECONDS = 10 * 60

/** Build the `/verify-magic-link?token=…` URL. */
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
 * Mint a verify URL that signs the recipient in on click. Used by
 * team invitations, recovery-code consumption, the Cloud bootstrap
 * claim flow, and portal email-OTP fallback.
 *
 * Writes the verification row directly via BA's internal adapter
 * instead of going through `auth.api.signInMagicLink` — that endpoint
 * fires our `hooksBefore` chain (rate-limit, team magic-link toggle,
 * hard-binding) which is correct for user-initiated sign-in but wrong
 * for internal token-mint. Token format mirrors BA's magic-link
 * plugin so its `/magic-link/verify` endpoint reads our row.
 */
export async function mintMagicLinkUrl(opts: MintOptions): Promise<string> {
  const auth = await getAuth()
  const token = generateRandomString(32, 'a-z', 'A-Z')
  const expiresInSeconds = opts.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS

  // `$context` is a PromiseLike on the real BA instance; the test mock
  // is a plain object. `await` handles both.
  const ctx = await auth.$context
  await ctx.internalAdapter.createVerificationValue({
    identifier: token,
    value: JSON.stringify({ email: opts.email, attempt: 0 }),
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  })

  return buildVerifyMagicLinkUrl({
    origin: opts.portalUrl,
    token,
    callbackPath: opts.callbackPath,
    errorCallbackPath: opts.errorCallbackPath,
  })
}
