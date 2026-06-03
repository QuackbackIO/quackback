/**
 * Daily sweep for stale invitations (portal AND team).
 *
 * Finds pending invites of either kind that have passed their `expiresAt`,
 * emits one `portal.invite.expired` audit event per invite (actor: system),
 * then bulk-updates their status to `'expired'` so they are not re-swept
 * on the next run.
 *
 * The sweep used to filter only `kind='portal'`, which left team invites
 * stuck in `pending` forever after expiry — the admin's "An invitation
 * has already been sent to this email" duplicate check then permanently
 * blocked re-invites.
 *
 * Design properties:
 *  - Idempotent: the status update ensures a swept invite is never re-emitted.
 *  - Bounded: single SELECT + single UPDATE per run regardless of count.
 *  - Best-effort audit: emit failures are logged but don't abort the status
 *    update — the status update is the more important correctness property.
 *  - Returns the number of invites swept so callers can log / monitor.
 */
import { db, invitation, and, eq, lt, inArray, or } from '@/lib/server/db'
import { recordAuditEvent } from './log'

export async function sweepExpiredPortalInvites(): Promise<number> {
  const now = new Date()

  const stale = await db.query.invitation.findMany({
    where: and(
      or(eq(invitation.kind, 'portal'), eq(invitation.kind, 'team')),
      eq(invitation.status, 'pending'),
      lt(invitation.expiresAt, now)
    ),
  })

  if (stale.length === 0) return 0

  // Single bulk UPDATE first — idempotent, never re-sweeps the same row.
  //
  // The WHERE pins `status='pending'` (in addition to the id-list) to close
  // the TOCTOU window between the SELECT above and this UPDATE: if an
  // invitee accepts their link in that gap, the row flips to 'accepted'
  // and must not be silently overwritten to 'expired'. Every sister write
  // (cancelPortalInviteFn, resendPortalInviteFn, acceptPortalInviteFn)
  // pins the same predicate for the same reason.
  //
  // `.returning()` lets us emit audit rows only for invites the UPDATE
  // actually flipped. Previously we emitted before the UPDATE — a
  // concurrent accept then left a ghost `portal.invite.expired` row in
  // the audit log for an invite that was actually accepted.
  const actuallyExpired = await db
    .update(invitation)
    .set({ status: 'expired' })
    .where(
      and(
        inArray(
          invitation.id,
          stale.map((i) => i.id)
        ),
        eq(invitation.status, 'pending')
      )
    )
    .returning({
      id: invitation.id,
      email: invitation.email,
      createdAt: invitation.createdAt,
      kind: invitation.kind,
    })

  // Emit one audit row per invite that was actually flipped. Best-effort
  // — emit failures are logged but don't change the data outcome.
  // Team-kind invites get their own event so audit reviewers can
  // filter on event type alone without parsing metadata.
  for (const inv of actuallyExpired) {
    const event = inv.kind === 'team' ? 'team.invite.expired' : 'portal.invite.expired'
    await recordAuditEvent({
      event,
      outcome: 'success',
      actor: { type: 'system' },
      target: { type: 'invitation', id: inv.id },
      metadata: {
        email: inv.email,
        sentAt: inv.createdAt.toISOString(),
        neverAccepted: true,
      },
    }).catch((err) => console.warn('[invite-sweep] audit emit failed:', err))
  }

  console.log(`[invite-sweep] marked ${actuallyExpired.length} invites as expired`)
  return actuallyExpired.length
}
