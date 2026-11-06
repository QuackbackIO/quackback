import { generateRandomString } from 'better-auth/crypto'
import { db, verification, inArray } from '@/lib/server/db'
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

/**
 * Better-Auth 1.7.7+ keys each magic-link row as `magic-link:<token>` and parses
 * its value with a strict `{ type: 'magic-link', email, name? }` schema. Rows
 * written with the bare token or the older value shape fail verification.
 */
const MAGIC_LINK_IDENTIFIER_PREFIX = 'magic-link:'

/** The verification-row identifier for a bare magic-link token. */
function magicLinkIdentifier(token: string): string {
  return `${MAGIC_LINK_IDENTIFIER_PREFIX}${token}`
}

/**
 * Every identifier a token may have been stored under: the prefixed one, and
 * the bare token for links minted before the prefix. Those legacy rows no longer
 * verify, but they still need deleting when the link is revoked.
 */
function revocableIdentifiers(token: string): string[] {
  return [magicLinkIdentifier(token), token]
}

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
 * for internal token-mint. The row mirrors BA's magic-link plugin
 * (see `magicLinkIdentifier`) so its `/magic-link/verify` endpoint reads it.
 */
export async function mintMagicLinkUrl(
  opts: MintOptions
): Promise<{ url: string; token: string; sealedAddress: string }> {
  const auth = await getAuth()
  const token = generateRandomString(32, 'a-z', 'A-Z')
  const expiresInSeconds = opts.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS

  // `$context` is a PromiseLike on the real BA instance; the test mock
  // is a plain object. `await` handles both.
  const ctx = await auth.$context
  await ctx.internalAdapter.createVerificationValue({
    identifier: magicLinkIdentifier(token),
    value: JSON.stringify({ type: 'magic-link', email: opts.email }),
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  })

  const url = buildVerifyMagicLinkUrl({
    origin: opts.portalUrl,
    token,
    callbackPath: opts.callbackPath,
    errorCallbackPath: opts.errorCallbackPath,
  })
  // `token` is the bare token: it goes in the URL and names the link for
  // revocation. Callers that need to invalidate the link later (invitations)
  // persist it and pass it to the revoke helpers, which find the row by its
  // prefixed identifier. Sign-in callers ignore it.
  //
  // `sealedAddress` is the address actually written into the verification row
  // above. Senders mail THAT rather than whatever string they happen to be
  // holding, so the token can never be delivered somewhere it cannot be
  // redeemed — or, worse, somewhere it can.
  return { url, token, sealedAddress: opts.email }
}

/**
 * Delete the verification row backing a previously-minted magic link, so the
 * link can no longer be verified. Used by invitations when they're cancelled
 * or re-issued. No-op when `token` is null/undefined (e.g. an invite minted
 * before the token was tracked, or a path that never stored one).
 */
export async function revokeMagicLinkToken(token: string | null | undefined): Promise<void> {
  if (!token) return
  await db.delete(verification).where(inArray(verification.identifier, revocableIdentifiers(token)))
}

/**
 * Bulk-revoke a set of magic-link tokens by deleting their verification rows.
 * Used by invite cancellation to invalidate every link the invite ever minted.
 * No-op on an empty set; already-consumed/expired tokens simply match no rows.
 */
export async function revokeMagicLinkTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  await db
    .delete(verification)
    .where(inArray(verification.identifier, tokens.flatMap(revocableIdentifiers)))
}
