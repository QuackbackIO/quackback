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
 * Append a freshly-minted token to the invite's token set, but only while the
 * invite is still `pending`. Returns true if appended, false if the invite is
 * no longer pending (canceled / accepted / expired) — in which case the caller
 * should revoke the token it just minted rather than leave it live.
 *
 * Appending (rather than replacing) means a token is recorded the instant it's
 * minted, so it can never be live-but-untracked: even if the email send then
 * fails or the worker restarts, cancellation still revokes it via the set.
 */
export async function appendInviteMagicLinkToken(
  inviteId: InviteId,
  token: string
): Promise<boolean> {
  const { db, invitation, eq, and, sql } = await import('@/lib/server/db')
  const updated = await db
    .update(invitation)
    .set({ magicLinkTokens: sql`array_append(${invitation.magicLinkTokens}, ${token})` })
    .where(and(eq(invitation.id, inviteId), eq(invitation.status, 'pending')))
    .returning({ id: invitation.id })
  return updated.length > 0
}

/**
 * Drop a token from the invite's set and revoke its verification row. Used to
 * discard a token whose link was never delivered (e.g. the email send threw),
 * keeping the set to links that actually went out.
 */
export async function removeInviteMagicLinkToken(inviteId: InviteId, token: string): Promise<void> {
  const { db, invitation, eq, sql } = await import('@/lib/server/db')
  const { revokeMagicLinkToken } = await import('@/lib/server/auth/magic-link-mint')
  await db
    .update(invitation)
    .set({ magicLinkTokens: sql`array_remove(${invitation.magicLinkTokens}, ${token})` })
    .where(eq(invitation.id, inviteId))
  await revokeMagicLinkToken(token)
}
