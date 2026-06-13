import { generateRandomString } from 'better-auth/crypto'
import { db, verification, eq, and, gt, inArray, desc } from '@/lib/server/db'
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
export async function mintMagicLinkUrl(opts: MintOptions): Promise<{ url: string; token: string }> {
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

  const url = buildVerifyMagicLinkUrl({
    origin: opts.portalUrl,
    token,
    callbackPath: opts.callbackPath,
    errorCallbackPath: opts.errorCallbackPath,
  })
  // `token` is the verification-row identifier. Callers that need to be able
  // to invalidate the link later (invitations) persist it; sign-in callers
  // ignore it.
  return { url, token }
}

/**
 * Delete the verification row backing a previously-minted magic link, so the
 * link can no longer be verified. Used by invitations when they're cancelled
 * or re-issued. No-op when `token` is null/undefined (e.g. an invite minted
 * before the token was tracked, or a path that never stored one).
 */
export async function revokeMagicLinkToken(token: string | null | undefined): Promise<void> {
  if (!token) return
  // `token` is the row's `identifier` — see `createVerificationValue` in
  // mintMagicLinkUrl above, which stores the raw token as the identifier.
  await db.delete(verification).where(eq(verification.identifier, token))
}

/**
 * Bulk-revoke a set of magic-link tokens by deleting their verification rows.
 * Used by invite cancellation to invalidate every link the invite ever minted.
 * No-op on an empty set; already-consumed/expired tokens simply match no rows.
 */
export async function revokeMagicLinkTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  await db.delete(verification).where(inArray(verification.identifier, tokens))
}

/**
 * Return the longest-lived still-verifiable token from the given set — its
 * verification row exists (single-use, so it's deleted once consumed) and has
 * not expired — or null if none are live. Lets the copy-link path reuse the
 * invite's current link instead of minting a new one. Ordered by expiry so a
 * resent invite hands out the token that covers the most of its lifetime, not
 * an arbitrary older one.
 */
export async function findLiveMagicLinkToken(tokens: string[]): Promise<string | null> {
  if (tokens.length === 0) return null
  const rows = await db
    .select({ identifier: verification.identifier })
    .from(verification)
    .where(and(inArray(verification.identifier, tokens), gt(verification.expiresAt, new Date())))
    .orderBy(desc(verification.expiresAt))
    .limit(1)
  return rows[0]?.identifier ?? null
}
