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
import { recordInviteMagicLinkToken } from './invitation-magic-link'
import { actorFromAuth, recordAuditEvent } from '@/lib/server/audit/log'
import { getBaseUrl } from '@/lib/server/config'
import { sendPortalInviteEmail } from '@quackback/email'
import { getSession } from '@/lib/server/auth/session'
import { safeEmail } from '@/lib/shared/utils/string'

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

  // Mint before the insert so the row records its token (lets cancel/resend
  // revoke the link). inviteId is fixed above, so the callback path is known.
  const portalUrl = getBaseUrl()
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
    magicLinkToken,
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
      expiresAt: expiresAt.toISOString(),
      hasMessage: !!message,
      ...(batchId ? { batchId } : {}),
    },
  })

  console.log(
    `[fn:portal-invites] sendOnePortalInvite: sent id=${inviteId} email=${safeEmail(email)}`
  )
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
  .inputValidator(sendPortalInviteSchema)
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
        console.warn(`[fn:portal-invites] bulk send failed for ${safeEmail(email)}:`, errorMsg)
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
  .inputValidator(portalInviteByIdSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const inviteId = data.inviteId as InviteId
    const headers = getRequestHeaders()
    const actor = actorFromAuth(auth)

    console.log(`[fn:portal-invites] cancelPortalInviteFn: id=${inviteId}`)

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
      .returning({ id: invitation.id, magicLinkToken: invitation.magicLinkToken })

    if (updated.length === 0) {
      console.log(`[fn:portal-invites] cancelPortalInviteFn: no-op (row concurrently mutated)`)
      return { inviteId, status: 'no_op_already_accepted' as const }
    }

    // Invalidate the emailed magic link so a cancelled invite can't sign anyone
    // in. Revoke the token the UPDATE returned (live at the instant of
    // cancellation) rather than the earlier read, so a rotation racing this
    // cancel can't leave a live token behind.
    const { revokeMagicLinkToken } = await import('@/lib/server/auth/magic-link-mint')
    await revokeMagicLinkToken(updated[0].magicLinkToken)

    await recordAuditEvent({
      event: 'portal.invite.revoked',
      actor,
      headers,
      target: { type: 'invitation', id: inviteId },
      before: { email: inv.email, status: 'pending' },
      after: { email: inv.email, status: 'canceled' },
    })

    console.log(`[fn:portal-invites] cancelPortalInviteFn: canceled`)
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
  .inputValidator(portalInviteByIdSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const inviteId = data.inviteId as InviteId
    const headers = getRequestHeaders()
    const actor = actorFromAuth(auth)

    console.log(`[fn:portal-invites] resendPortalInviteFn: id=${inviteId}`)

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
      console.warn(
        `[fn:portal-invites] resendPortalInviteFn: TOCTOU lost — invite ${inviteId} no longer pending`
      )
      throw new Error('Portal invitation is no longer pending.')
    }

    const portalUrl = getBaseUrl()
    const { url: inviteLink, token: magicLinkToken } = await mintPortalInviteMagicLink(
      inv.email,
      inviteId,
      portalUrl
    )

    const { revokeMagicLinkToken } = await import('@/lib/server/auth/magic-link-mint')
    const priorToken = inv.magicLinkToken

    // Record the new token BEFORE sending so the emailed link is always tracked
    // and a concurrent cancel/rotation is caught before delivery.
    if (!(await recordInviteMagicLinkToken(inviteId, priorToken, magicLinkToken))) {
      await revokeMagicLinkToken(magicLinkToken) // not emailed yet; safe to drop
      throw new Error('Invitation is no longer pending — refresh and try again')
    }

    // The prior token is revoked only AFTER the email is sent (or surfaced for
    // manual sharing when email isn't configured), so a send failure can't
    // strand the invitee by killing the still-valid link they already have.
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
      // Send failed: undo the record (restore the prior token) and drop the
      // undelivered new one, leaving the invitee's existing link working.
      await recordInviteMagicLinkToken(inviteId, magicLinkToken, priorToken)
      await revokeMagicLinkToken(magicLinkToken)
      throw sendError
    }
    await revokeMagicLinkToken(priorToken)

    await recordAuditEvent({
      event: 'portal.invite.resent',
      outcome: 'success',
      actor,
      headers,
      target: { type: 'invitation', id: inviteId },
      metadata: { email: inv.email },
    })

    console.log(
      `[fn:portal-invites] resendPortalInviteFn: ${result.sent ? 'resent' : 'regenerated (email not configured)'}`
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

  console.log(`[fn:portal-invites] fetchPortalInvitesFn`)

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
    createdAt: inv.createdAt.toISOString(),
    lastSentAt: inv.lastSentAt?.toISOString() ?? null,
    expiresAt: inv.expiresAt.toISOString(),
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
  .inputValidator(portalInviteByIdSchema)
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

    const portalUrl = getBaseUrl()
    const { isMagicLinkTokenLive, buildVerifyMagicLinkUrl, revokeMagicLinkToken } =
      await import('@/lib/server/auth/magic-link-mint')

    let inviteLink: string
    // Copying returns the invite's CURRENT live link rather than rotating it, so
    // a link the invitee may already hold keeps working. Only mint a fresh token
    // when there isn't a live one (never sent, or it was already used/expired).
    const currentToken = inv.magicLinkToken
    if (currentToken && (await isMagicLinkTokenLive(currentToken))) {
      inviteLink = buildVerifyMagicLinkUrl({
        origin: portalUrl,
        token: currentToken,
        callbackPath: portalInviteCallbackPath(inv.id),
      })
    } else {
      // Cap the fresh token at the invite's remaining lifetime — copy-link does
      // not extend the row, so otherwise a late copy could outlive its expiry.
      const remainingSeconds = Math.floor((inv.expiresAt.getTime() - Date.now()) / 1000)
      const minted = await mintPortalInviteMagicLink(inv.email, inv.id, portalUrl, remainingSeconds)
      // Record the new token (catches a concurrent cancel/rotation). The prior
      // token, if any, is already dead — that's why we're minting — so there is
      // nothing live to revoke.
      if (!(await recordInviteMagicLinkToken(inv.id, inv.magicLinkToken, minted.token))) {
        await revokeMagicLinkToken(minted.token)
        throw new Error('Invite is no longer pending — refresh and try again')
      }
      inviteLink = minted.url
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
  .inputValidator(portalInviteByIdSchema)
  .handler(async ({ data }): Promise<AcceptPortalInviteResult> => {
    const inviteId = data.inviteId as InviteId
    const headers = getRequestHeaders()

    console.log(`[fn:portal-invites] acceptPortalInviteFn: id=${inviteId}`)

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
      console.warn(
        `[fn:portal-invites] acceptPortalInviteFn: email mismatch invite=${safeEmail(inv.email)} session=${safeEmail(sessionEmail)}`
      )
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
      console.log(`[fn:portal-invites] acceptPortalInviteFn: already accepted`)
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
      console.warn(
        `[fn:portal-invites] acceptPortalInviteFn: email not verified session=${safeEmail(sessionEmail)}`
      )
      return { status: 'email_not_verified' }
    }

    if (inv.status === 'canceled') {
      console.log(`[fn:portal-invites] acceptPortalInviteFn: invite is canceled`)
      return { status: 'canceled' }
    }

    if (new Date(inv.expiresAt) < new Date()) {
      console.log(`[fn:portal-invites] acceptPortalInviteFn: invite is expired`)
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
      console.log(
        `[fn:portal-invites] acceptPortalInviteFn: TOCTOU lost — terminal state status=${fresh.status} expired=${new Date(fresh.expiresAt) < new Date()}`
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

    console.log(`[fn:portal-invites] acceptPortalInviteFn: accepted id=${inviteId}`)
    return { status: 'accepted', alreadyAccepted: false }
  })
