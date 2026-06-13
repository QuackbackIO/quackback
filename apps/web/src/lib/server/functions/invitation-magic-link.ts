/**
 * Team-invitation magic link — the team counterpart to portal-invites.ts.
 * Split out of admin.ts (and its large import surface) so the link's
 * lifetime can be reasoned about and tested in isolation. Also hosts the
 * shared token-rotation helper used by both team and portal invite paths.
 */
import type { InviteId } from '@quackback/ids'

/**
 * Team invitation lifetime — 30 days. Source of truth for both the
 * invitation row's `expiresAt` and the emailed magic-link token TTL.
 *
 * The token deliberately lives this long rather than falling back to
 * `mintMagicLinkUrl`'s 10-minute sign-in default: an invite is emailed and
 * opened asynchronously — often days later — and the invitation row still
 * governs long-term access either way.
 */
export const INVITATION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Mint the invite's one-click sign-in link (lives for INVITATION_EXPIRY_MS).
 * Returns both the URL and its `token` — persist the token on the invite row
 * so {@link revokeMagicLinkToken} can invalidate the link on cancel/re-send.
 */
export async function generateInvitationMagicLink(
  email: string,
  callbackPath: string,
  portalUrl: string
): Promise<{ url: string; token: string }> {
  console.log(
    `[fn:invite] generateInvitationMagicLink: email=${email}, callbackPath=${callbackPath}, portalUrl=${portalUrl}`
  )
  const { mintMagicLinkUrl } = await import('@/lib/server/auth/magic-link-mint')
  return mintMagicLinkUrl({
    email,
    callbackPath,
    portalUrl,
    expiresInSeconds: INVITATION_EXPIRY_MS / 1000,
  })
}

/**
 * Compare-and-swap the invite's recorded magic-link token from `expected` to
 * `next`, only while the invite is still `pending`. Returns true if the row
 * matched and was updated, false otherwise (the invite was canceled, or another
 * request changed the token first).
 *
 * Callers record the new token with this BEFORE delivering its link (emailing,
 * or returning it to copy), so the delivered token is always the one tracked on
 * the invite and a concurrent cancel/rotation is detected before delivery. The
 * old token is only revoked AFTER successful delivery, so a delivery failure
 * never strands the recipient. Passing `next: null` restores the unset state
 * (used to roll back a record when delivery then fails).
 */
export async function recordInviteMagicLinkToken(
  inviteId: InviteId,
  expected: string | null | undefined,
  next: string | null
): Promise<boolean> {
  const { db, invitation, eq, and, isNull } = await import('@/lib/server/db')
  const swapped = await db
    .update(invitation)
    .set({ magicLinkToken: next })
    .where(
      and(
        eq(invitation.id, inviteId),
        eq(invitation.status, 'pending'),
        expected == null
          ? isNull(invitation.magicLinkToken)
          : eq(invitation.magicLinkToken, expected)
      )
    )
    .returning({ id: invitation.id })
  return swapped.length > 0
}
