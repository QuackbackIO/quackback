/**
 * Server functions for portal email invites.
 *
 * Provides admin-only operations for sending, cancelling, resending, and
 * listing portal-access invitations, plus the invitee-facing accept function.
 * A portal invite lets an admin grant a specific person access to a private
 * portal without adding them to the team.
 *
 * The accept flow (magic-link callback) calls acceptPortalInviteFn from the
 * portal-invite.$inviteId route.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { InviteId, UserId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { db, invitation, principal, user, eq, and, gt, or, sql } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { appendInviteMagicLinkToken, removeInviteMagicLinkToken } from './invitation-magic-link'
import { actorFromAuth, recordAuditEvent } from '@/lib/server/audit/log'
import { resolvePublicBaseUrl } from '@/lib/server/public-url'
import { sendPortalInviteEmail } from '@quackback/email'
import { getSession } from '@/lib/server/auth/session'
import { safeEmail } from '@/lib/shared/utils/string'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'

import { logger } from '@/lib/server/logger'
const log = logger.child({ component: 'portal-invites' })
/** Portal invite lifetime — 30 days. */
const PORTAL_INVITE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

/** Magic-link token lifetime — matches the invite's full lifetime so a
 *  link emailed and opened days later still works. The 10-minute sign-in
 *  default would strand invitees who don't click immediately; the invite
 *  row's own `expiresAt` still governs long-term access. */
const PORTAL_INVITE_MAGIC_LINK_TTL_SECONDS = PORTAL_INVITE_EXPIRY_MS / 1000

/** The magic-link callback path a portal invitee lands on to accept. Shared by
 *  the mint and copy-link paths so the two always build the same URL. */
const portalInviteCallbackPath = (inviteId: string) => `/portal-invite/${inviteId}`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PORTAL_INVITE_BATCH_CAP = 50

const sendPortalInviteSchema = z.object({
  emails: z
    .array(z.string().email())
    .min(1, 'At least one email is required')
    .max(PORTAL_INVITE_BATCH_CAP, `Send at most ${PORTAL_INVITE_BATCH_CAP} invites at a time`),
  message: z.string().trim().max(500).optional(),
})

const portalInviteByIdSchema = z.object({
  inviteId: z.string(),
})

// ---------------------------------------------------------------------------
// Internal helper — mint a magic link for a portal invite
// ---------------------------------------------------------------------------

async function mintPortalInviteMagicLink(
  email: string,
  inviteId: string,
  portalUrl: string,
  // Defaults to the full lifetime (see PORTAL_INVITE_MAGIC_LINK_TTL_SECONDS).
  // Copy-link passes the invite's *remaining* lifetime so a re-minted token
  // can't outlive the invite row it belongs to.
  expiresInSeconds: number = PORTAL_INVITE_MAGIC_LINK_TTL_SECONDS
): Promise<{ url: string; token: string }> {
  const { mintMagicLinkUrl } = await import('@/lib/server/auth/magic-link-mint')
  return mintMagicLinkUrl({
    email,
    callbackPath: portalInviteCallbackPath(inviteId),
    portalUrl,
    expiresInSeconds,
  })
}

// ---------------------------------------------------------------------------
// sendOnePortalInvite — per-email helper used by sendPortalInviteFn
// ---------------------------------------------------------------------------

type SendOnePortalInviteArgs = {
  email: string
  message: string | undefined
  batchId: string | undefined
  auth: Awaited<ReturnType<typeof requireAuth>>
  headers: Headers
  actor: ReturnType<typeof actorFromAuth>
}

async function sendOnePortalInvite({
  email,
  message,
  batchId,
  auth,
  headers,
  actor,
}: SendOnePortalInviteArgs): Promise<string> {
  // Reject if the email already belongs to a team member. Match
  // case-insensitively: better-auth normalises on the way in, but older
  // rows or OAuth providers can store mixed-case addresses, and `email`
  // here is always lower-cased by the caller.
  const existingTeamUser = await db.query.user.findFirst({
    where: sql`lower(${user.email}) = ${email}`,
  })
  if (existingTeamUser) {
    const existingPrincipal = await db.query.principal.findFirst({
      where: eq(principal.userId, existingTeamUser.id),
    })
    if (
      existingPrincipal &&
      (existingPrincipal.role === 'admin' || existingPrincipal.role === 'member')
    ) {
      throw new Error('This person is already a team member and has access to the portal.')
    }
  }

  // Reject if a non-expired pending portal invite already exists.
  // Same case-insensitive match — an old mixed-case invite row would
  // otherwise sneak past the dedup check.
  const now = new Date()
  const existingInvite = await db.query.invitation.findFirst({
    where: and(
      sql`lower(${invitation.email}) = ${email}`,
      eq(invitation.kind, 'portal'),
      eq(invitation.status, 'pending'),
      gt(invitation.expiresAt, now)
    ),
  })
  if (existingInvite) {
    throw new Error('A pending portal invitation has already been sent to this email address.')
  }

  const inviteId = generateId('invite')
  const expiresAt = new Date(now.getTime() + PORTAL_INVITE_EXPIRY_MS)

  // Mint before the insert so the row records its token in its token set
  // (cancel revokes every token in the set). inviteId is fixed above, so the
  // callback path is known.
  const portalUrl = resolvePublicBaseUrl(headers)
  const { url: inviteLink, token: magicLinkToken } = await mintPortalInviteMagicLink(
    email,
    inviteId,
    portalUrl
  )

  await db.insert(invitation).values({
    id: inviteId,
    email,
    name: null,
    role: null,
    kind: 'portal',
    status: 'pending',
    expiresAt,
    createdAt: now,
    lastSentAt: now,
    inviterId: auth.user.id as UserId,
    magicLinkTokens: [magicLinkToken],
  })

  const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
  const logoUrl = getEmailSafeUrl(auth.settings.logoKey) ?? undefined
  await sendPortalInviteEmail({
    to: email,
    workspaceName: auth.settings.name,
    inviteLink,
    logoUrl,
    personalMessage: message,
  })

  await recordAuditEvent({
    event: 'portal.invite.sent',
    outcome: 'success',
    actor,
    headers,
    target: { type: 'invitation', id: inviteId },
    metadata: {
      email,
      expiresAt: toIsoString(expiresAt),
      hasMessage: !!message,
      ...(batchId ? { batchId } : {}),
    },
  })

  log.info({ invite_id: inviteId, email_masked: safeEmail(email) }, 'portal invite sent')
  return inviteId
}

// ---------------------------------------------------------------------------
// sendPortalInviteFn
// ---------------------------------------------------------------------------

type SendPortalInviteResult = {
  results: Array<
    { email: string; ok: true; inviteId: string } | { email: string; ok: false; error: string }
  >
}

/**
 * Send portal-access invitations to one or more email addresses (up to 50).
 *
 * Returns a per-email result so callers can surface partial failures without
 * throwing on the first bad address. Each successful send emits a
 * `portal.invite.sent` audit event. An optional personal message is
 * forwarded to the email template.
 */
export const sendPortalInviteFn = createServerFn({ method: 'POST' })
  .validator(sendPortalInviteSchema)
  .handler(async ({ data }): Promise<SendPortalInviteResult> => {
    const auth = await requireAuth({ roles: ['admin'] })
    const headers = getRequestHeaders()
    const actor = actorFromAuth(auth)
    const message = data.message?.trim() || undefined

    if (data.emails.length > PORTAL_INVITE_BATCH_CAP) {
      throw new Error(`Send at most ${PORTAL_INVITE_BATCH_CAP} invites at a time`)
    }

    const batchId = data.emails.length > 1 ? `batch_${crypto.randomUUID()}` : undefined

    const results: SendPortalInviteResult['results'] = []
    for (const rawEmail of data.emails) {
      const email = rawEmail.toLowerCase().trim()
      try {
        const inviteId = await sendOnePortalInvite({
          email,
          message,
          batchId,
          auth,
          headers,
          actor,
        })
        results.push({ email, ok: true, inviteId })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        log.warn({ email_masked: safeEmail(email), error: errorMsg }, 'bulk send failed')
        results.push({ email, ok: false, error: errorMsg })
      }
    }
    return { results }
  })

// ---------------------------------------------------------------------------
// cancelPortalInviteFn
// ---------------------------------------------------------------------------

/**
 * Cancel a pending portal invite.
 *
 * The invite must be `kind='portal'` and not already in a terminal state
 * (accepted | canceled). Records a `portal.invite.revoked` audit event.
 */
export const cancelPortalInviteFn = createServerFn({ method: 'POST' })
  .validator(portalInviteByIdSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const inviteId = data.inviteId as InviteId
    const headers = getRequestHeaders()
    const actor = actorFromAuth(auth)

    log.debug({ invite_id: inviteId }, 'cancel portal invite')

    const inv = await db.query.invitation.findFirst({
      where: and(eq(invitation.id, inviteId), eq(invitation.kind, 'portal')),
    })

    if (!inv) {
      throw new Error('Portal invitation not found.')
    }
    if (inv.status !== 'pending') {
      throw new Error(`Cannot cancel an invitation that is already ${inv.status}.`)
    }

    // Include status='pending' in the WHERE clause to guard against a concurrent
    // accept that flips the row between the SELECT above and this UPDATE.
    // If the row was concurrently accepted, affected rows = 0 — treat as no-op
    // and skip the audit event; the admin's next list refresh will see the new state.
    const updated = await db
      .update(invitation)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(invitation.id, inviteId),
          eq(invitation.kind, 'portal'),
          eq(invitation.status, 'pending')
        )
      )
      .returning({ id: invitation.id, magicLinkTokens: invitation.magicLinkTokens })

    if (updated.length === 0) {
      log.debug({ invite_id: inviteId }, 'cancel portal invite no-op, row concurrently mutated')
      return { inviteId, status: 'no_op_already_accepted' as const }
    }

    // Invalidate every link this invite ever minted so a cancelled invite can't
    // sign anyone in. Revoking the full set (returned atomically by the status
    // flip) closes the resend/copy/worker-restart windows where a single
    // rotating pointer could leave a token live but untracked.
    const { revokeMagicLinkTokens } = await import('@/lib/server/auth/magic-link-mint')
    await revokeMagicLinkTokens(updated[0].magicLinkTokens)

    await recordAuditEvent({
      event: 'portal.invite.revoked',
      actor,
      headers,
      target: { type: 'invitation', id: inviteId },
      before: { email: inv.email, status: 'pending' },
      after: { email: inv.email, status: 'canceled' },
    })

    log.info({ invite_id: inviteId }, 'portal invite canceled')
    return { inviteId, status: 'canceled' as const }
  })

// ---------------------------------------------------------------------------
// resendPortalInviteFn
// ---------------------------------------------------------------------------

/**
 * Resend a portal invite email.
 *
 * The invite must be `kind='portal'`, `status='pending'`, and not expired.
 * Mints a fresh magic link, updates `lastSentAt`, and re-sends the email.
 * Records a `portal.invite.resent` audit event.
 */
export const resendPortalInviteFn = createServerFn({ method: 'POST' })
  .validator(portalInviteByIdSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const inviteId = data.inviteId as InviteId
    const headers = getRequestHeaders()
    const actor = actorFromAuth(auth)

    log.debug({ invite_id: inviteId }, 'resend portal invite')

    const inv = await db.query.invitation.findFirst({
      where: and(
        eq(invitation.id, inviteId),
        eq(invitation.kind, 'portal'),
        eq(invitation.status, 'pending')
      ),
    })

    if (!inv) {
      throw new Error('Portal invitation not found or is not pending.')
    }

    if (new Date(inv.expiresAt) < new Date()) {
      throw new Error('This invitation has expired. Please cancel it and send a new one.')
    }

    // Claim the slot FIRST, then mint + send. The previous ordering sent
    // the email before the UPDATE — if a concurrent accept/cancel/sweep
    // landed during the SMTP window, the admin saw an error while the
    // invitee already had a usable magic-link email pointing at a row
    // the server now considers terminal. Claiming first means the email
    // only ever goes out for an invite we've successfully extended.
    //
    // The UPDATE WHERE pins status='pending' AND expiresAt > now() so
    // neither a concurrent terminal-state flip nor an expiry that
    // landed between SELECT and UPDATE can be silently rescued by the
    // expiry-extension. `.returning()` surfaces the zero-row race; we
    // treat it as a terminal-state collision and abort BEFORE any
    // user-visible side effects.
    const resendNow = new Date()
    const freshExpiresAt = new Date(resendNow.getTime() + PORTAL_INVITE_EXPIRY_MS)
    const updated = await db
      .update(invitation)
      .set({ lastSentAt: resendNow, expiresAt: freshExpiresAt })
      .where(
        and(
          eq(invitation.id, inviteId),
          eq(invitation.kind, 'portal'),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, resendNow)
        )
      )
      .returning()

    if (updated.length === 0) {
      // Concurrent state change — invite is no longer pending. Abort
      // before minting a magic link or sending an email — those side
      // effects would otherwise leak a live link for a terminal row.
      log.warn({ invite_id: inviteId }, 'resend toctou, invite no longer pending')
      throw new Error('Portal invitation is no longer pending.')
    }

    const portalUrl = resolvePublicBaseUrl(headers)
    const { url: inviteLink, token: magicLinkToken } = await mintPortalInviteMagicLink(
      inv.email,
      inviteId,
      portalUrl
    )

    // Add the new token to the invite's set (resend is additive — prior links
    // keep working until accept/cancel/expiry). Recorded the moment it's minted,
    // so a send failure or worker restart can't leave it live-but-untracked.
    const { revokeMagicLinkToken } = await import('@/lib/server/auth/magic-link-mint')
    if (!(await appendInviteMagicLinkToken(inviteId, magicLinkToken))) {
      await revokeMagicLinkToken(magicLinkToken) // invite no longer pending; drop it
      throw new Error('Invitation is no longer pending — refresh and try again')
    }

    const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
    const logoUrl = getEmailSafeUrl(auth.settings.logoKey) ?? undefined
    let result: Awaited<ReturnType<typeof sendPortalInviteEmail>>
    try {
      result = await sendPortalInviteEmail({
        to: inv.email,
        workspaceName: auth.settings.name,
        inviteLink,
        logoUrl,
      })
    } catch (sendError) {
      // The new link never went out — drop it from the set and revoke it.
      await removeInviteMagicLinkToken(inviteId, magicLinkToken)
      throw sendError
    }

    await recordAuditEvent({
      event: 'portal.invite.resent',
      outcome: 'success',
      actor,
      headers,
      target: { type: 'invitation', id: inviteId },
      metadata: { email: inv.email },
    })

    log.info(
      { invite_id: inviteId, email_sent: result.sent },
      result.sent ? 'portal invite resent' : 'portal invite regenerated, email not configured'
    )
    return { inviteId, emailSent: result.sent, inviteLink: !result.sent ? inviteLink : undefined }
  })

// ---------------------------------------------------------------------------
// fetchPortalInvitesFn
// ---------------------------------------------------------------------------

/**
 * List portal invites for the admin UI.
 *
 * Returns only `kind='portal'` rows — pending first (by sent date desc),
 * then recently-accepted/revoked — capped at 100 rows.
 */
export const fetchPortalInvitesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })

  log.debug('fetching portal invites')

  const rows = await db.query.invitation.findMany({
    where: and(
      eq(invitation.kind, 'portal'),
      or(
        eq(invitation.status, 'pending'),
        eq(invitation.status, 'accepted'),
        eq(invitation.status, 'canceled')
      )
    ),
    orderBy: [
      // Pending first — active invites are most actionable.
      sql`CASE WHEN "invitation"."status" = 'pending' THEN 0 ELSE 1 END`,
      sql`"invitation"."last_sent_at" DESC NULLS LAST`,
      sql`"invitation"."created_at" DESC`,
    ],
    limit: 100,
  })

  return rows.map((inv) => ({
    id: inv.id,
    email: inv.email,
    status: inv.status,
    kind: inv.kind,
    createdAt: toIsoString(inv.createdAt),
    lastSentAt: toIsoStringOrNull(inv.lastSentAt),
    expiresAt: toIsoString(inv.expiresAt),
  }))
})

// ---------------------------------------------------------------------------
// getPortalInviteLinkFn
// ---------------------------------------------------------------------------

/**
 * Mint a fresh magic-link for a pending portal invite.
 *
 * Admin-only. The link lives as long as the invite (see
 * PORTAL_INVITE_MAGIC_LINK_TTL_SECONDS). The invite row itself must
 * be `kind='portal'`, `status='pending'`, and not past its own `expiresAt`.
 * Records a `portal.invite.link_minted` audit event on success.
 */
export const getPortalInviteLinkFn = createServerFn({ method: 'POST' })
  .validator(portalInviteByIdSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const headers = getRequestHeaders()
    const actor = actorFromAuth(auth)

    const inv = await db.query.invitation.findFirst({
      where: and(eq(invitation.id, data.inviteId as InviteId), eq(invitation.kind, 'portal')),
    })
    if (!inv) throw new Error('PORTAL_INVITE_NOT_FOUND')
    if (inv.status !== 'pending') throw new Error(`Invite is ${inv.status}, cannot mint a link`)
    if (inv.expiresAt && inv.expiresAt < new Date()) throw new Error('Invite has expired')

    const portalUrl = resolvePublicBaseUrl(headers)
    const { revokeMagicLinkToken } = await import('@/lib/server/auth/magic-link-mint')

    // Mint a fresh link and add it to the set. Minting is additive — it never
    // touches the invite's other outstanding links, so copying doesn't
    // invalidate a link the invitee may already hold. Capping the token at the
    // invite's remaining lifetime keeps it from outliving the invite, and a
    // freshly-minted token always covers that full window (no stale reuse).
    const remainingSeconds = Math.floor((inv.expiresAt.getTime() - Date.now()) / 1000)
    const { url: inviteLink, token } = await mintPortalInviteMagicLink(
      inv.email,
      inv.id,
      portalUrl,
      remainingSeconds
    )
    if (!(await appendInviteMagicLinkToken(inv.id, token))) {
      await revokeMagicLinkToken(token) // invite no longer pending; drop it
      throw new Error('Invite is no longer pending — refresh and try again')
    }

    await recordAuditEvent({
      event: 'portal.invite.link_minted',
      outcome: 'success',
      actor,
      headers,
      target: { type: 'invitation', id: inv.id },
      metadata: { email: inv.email },
    })

    return { inviteLink, expiresAt: inv.expiresAt }
  })

// ---------------------------------------------------------------------------
// acceptPortalInviteFn
// ---------------------------------------------------------------------------

/**
 * Discriminated result from acceptPortalInviteFn.
 *
 * The route renders a user-facing message for every non-accepted state;
 * on `accepted` it redirects to `/` so the portal gate grants entry.
 */
export type AcceptPortalInviteResult =
  | { status: 'accepted'; alreadyAccepted: boolean }
  | { status: 'canceled' }
  | { status: 'expired' }
  | { status: 'mismatch' }
  | { status: 'email_not_verified' }

/**
 * Accept a portal-access invitation for the currently signed-in user.
 *
 * Requires an authenticated session (any role — the invitee just signed in
 * via the magic-link and may not yet have a principal record).
 *
 * Validates the invite and returns a discriminated result:
 *   - `accepted`  — invite was pending + email matched → status set to accepted.
 *   - `accepted` (alreadyAccepted) — idempotent re-visit; no second audit event.
 *   - `canceled`  — invite was revoked before the invitee clicked.
 *   - `expired`   — invite's expiresAt is in the past.
 *   - `mismatch`  — session email does not match the invite email (case-insensitive).
 *
 * Throws on missing session (unauthenticated) or invite not found.
 */
export const acceptPortalInviteFn = createServerFn({ method: 'POST' })
  .validator(portalInviteByIdSchema)
  .handler(async ({ data }): Promise<AcceptPortalInviteResult> => {
    const inviteId = data.inviteId as InviteId
    const headers = getRequestHeaders()

    log.debug({ invite_id: inviteId }, 'accept portal invite')

    // Portal invitees may not have a principal record yet — use getSession()
    // directly instead of requireAuth() to avoid the principal existence check.
    const session = await getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }

    const sessionEmail = session.user.email?.toLowerCase()
    if (!sessionEmail) {
      throw new Error('Session has no email address')
    }

    const inv = await db.query.invitation.findFirst({
      where: and(eq(invitation.id, inviteId), eq(invitation.kind, 'portal')),
    })

    if (!inv) {
      throw new Error('PORTAL_INVITE_NOT_FOUND')
    }

    // Email mismatch — check first, before any status short-circuit, so a
    // caller signed in as the wrong account always gets `mismatch` regardless
    // of whether the invite has already been accepted.
    if (inv.email.toLowerCase() !== sessionEmail) {
      log.warn({ invite_id: inviteId }, 'accept portal invite email mismatch')
      return { status: 'mismatch' }
    }

    // Idempotent: already accepted — no second audit event, no further checks.
    // Runs BEFORE the emailVerified guard: the invite is already consumed,
    // so the verification-time concerns below ("(b) attacker pre-registers
    // and consumes the invite") don't apply — re-visits cannot re-consume
    // an accepted row. Putting alreadyAccepted first means a returning user
    // whose emailVerified flag was cleared (OAuth reconnection, etc.) still
    // sees the accepted state instead of being bounced to "verify email".
    if (inv.status === 'accepted') {
      log.debug({ invite_id: inviteId }, 'portal invite already accepted')
      return { status: 'accepted', alreadyAccepted: true }
    }

    // Reject unverified-email callers before any state mutation or audit.
    // Two failure modes prevented:
    //   (a) A legit user with an unverified address accepts and is then stuck
    //       because the portal gate requires emailVerified=true.
    //   (b) An attacker who pre-registered the victim's address (unverified)
    //       could otherwise accept the invite under their session, polluting
    //       the audit log and marking the invite consumed before the real
    //       owner clicks the link.
    if (!session.user.emailVerified) {
      log.warn({ invite_id: inviteId }, 'accept portal invite, email not verified')
      return { status: 'email_not_verified' }
    }

    if (inv.status === 'canceled') {
      log.debug({ invite_id: inviteId }, 'portal invite is canceled')
      return { status: 'canceled' }
    }

    if (new Date(inv.expiresAt) < new Date()) {
      log.debug({ invite_id: inviteId }, 'portal invite is expired')
      return { status: 'expired' }
    }

    // All checks passed — accept the invite atomically.
    //
    // The WHERE clause serializes the final state mutation across
    // concurrent callers. Between the initial read above and this
    // UPDATE, another caller could have accepted, an admin could have
    // canceled, or the sweep could have flipped the row to expired.
    // Pinning status='pending' + expires_at > now() + email match in
    // the predicate makes the write a no-op in those races. RETURNING
    // surfaces zero-row outcomes; we then re-read to report the
    // actual terminal state and skip the audit event.
    const updated = await db
      .update(invitation)
      .set({ status: 'accepted' })
      .where(
        and(
          eq(invitation.id, inviteId),
          eq(invitation.kind, 'portal'),
          eq(invitation.status, 'pending'),
          sql`lower(${invitation.email}) = ${sessionEmail}`,
          gt(invitation.expiresAt, new Date())
        )
      )
      .returning()

    if (updated.length === 0) {
      // Concurrent state change. Re-read to determine what won.
      const fresh = await db.query.invitation.findFirst({
        where: and(eq(invitation.id, inviteId), eq(invitation.kind, 'portal')),
      })
      if (!fresh) {
        // Vanishingly rare (would require a hard delete) — treat as not-found.
        throw new Error('PORTAL_INVITE_NOT_FOUND')
      }
      log.debug(
        {
          invite_id: inviteId,
          status: fresh.status,
          expired: new Date(fresh.expiresAt) < new Date(),
        },
        'accept portal invite toctou, terminal state'
      )
      if (fresh.status === 'accepted') {
        return { status: 'accepted', alreadyAccepted: true }
      }
      if (fresh.status === 'canceled') {
        return { status: 'canceled' }
      }
      // Still 'pending' but the expires_at predicate rejected → must be expired.
      return { status: 'expired' }
    }

    // Build a minimal actor from the session for the audit row.
    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, session.user.id as UserId),
      columns: { id: true, role: true, type: true },
    })
    const actor = {
      userId: session.user.id as UserId,
      email: session.user.email,
      role: principalRecord?.role ?? 'user',
    }

    await recordAuditEvent({
      event: 'portal.invite.accepted',
      actor,
      headers,
      target: { type: 'invitation', id: inviteId },
      after: { email: inv.email, kind: 'portal' },
    })

    // Accepted — revoke every token in the set so no other emailed/copied link
    // for this invite can still sign anyone in. The link just used was consumed
    // by the magic-link verify; siblings from resends/copies would otherwise
    // stay live until their 30-day expiry. Best-effort: the accept is already
    // committed, so a cleanup failure must not fail the request (the stray
    // tokens still expire with the invite).
    try {
      const { revokeMagicLinkTokens } = await import('@/lib/server/auth/magic-link-mint')
      await revokeMagicLinkTokens(updated[0].magicLinkTokens)
    } catch (revokeError) {
      log.error({ err: revokeError }, 'portal invite token revoke failed')
    }

    log.info({ invite_id: inviteId }, 'portal invite accepted')
    return { status: 'accepted', alreadyAccepted: false }
  })
