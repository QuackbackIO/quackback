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
 * Point an invite at a freshly-minted magic-link token: revoke the prior token
 * (so the previously-emailed link dies) and record the new one on the row. Used
 * by the resend and copy-link paths, which supersede an existing link; cancel
 * only revokes, so it calls `revokeMagicLinkToken` directly.
 *
 * The write is a compare-and-swap on `(status='pending', magicLinkToken=prior)`
 * rather than a blind last-write-wins, to stay correct under concurrency:
 *   - a request racing a cancel must not re-arm a live link on a canceled invite
 *   - a request racing another rotation must not orphan the other token (which
 *     would leave it live but untracked, so never revoked)
 * If the row no longer matches, the just-minted token is revoked (it isn't
 * tracked by the invite) and the call throws so the caller doesn't email or
 * return a now-dead link as success.
 */
export async function rotateInviteMagicLinkToken(
  inviteId: InviteId,
  priorToken: string | null | undefined,
  newToken: string
): Promise<void> {
  const { db, invitation, eq, and, isNull } = await import('@/lib/server/db')
  const { revokeMagicLinkToken } = await import('@/lib/server/auth/magic-link-mint')

  await revokeMagicLinkToken(priorToken)

  const swapped = await db
    .update(invitation)
    .set({ magicLinkToken: newToken })
    .where(
      and(
        eq(invitation.id, inviteId),
        eq(invitation.status, 'pending'),
        priorToken == null
          ? isNull(invitation.magicLinkToken)
          : eq(invitation.magicLinkToken, priorToken)
      )
    )
    .returning({ id: invitation.id })

  if (swapped.length === 0) {
    await revokeMagicLinkToken(newToken)
    throw new Error('Invitation changed during update — refresh and try again')
  }
}
