/**
 * Server functions for supplying a reachable address when the identity provider
 * released none.
 *
 * Signing in through such a provider mints an undeliverable placeholder onto
 * the account, so nothing can reach the person: no reply notification, no
 * changelog, nothing. These two functions are how they fix that.
 *
 * Nothing is written until the address is confirmed. `principal.contactEmail`
 * is a delivery target — `resolveReplyRecipient` places it above the
 * per-conversation capture — so accepting an unverified value would be a way to
 * point somebody else's replies at an address they do not own.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { requireAuth } from './auth-helpers'
import { ValidationError } from '@/lib/shared/errors'

const requestSchema = z.object({ email: z.string().max(320) })
const confirmSchema = z.object({ token: z.string().min(1).max(256) })

/**
 * Send a confirmation to `email`. Succeeds without revealing whether the
 * address is already in use anywhere, since the reply is visible to whoever
 * asked and they may not own it.
 */
export const requestContactEmailFn = createServerFn({ method: 'POST' })
  .validator(requestSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth()

    const { acceptableContactEmail, buildContactEmailChallenge } =
      await import('@/lib/server/domains/principals/contact-email')
    const email = acceptableContactEmail(data.email)
    if (!email) {
      throw new ValidationError('VALIDATION_ERROR', 'Enter a valid email address.')
    }

    // Keyed on the principal, not the address: limiting per address would let
    // one account walk through a list of them.
    const { getClientIp } = await import('@/lib/server/domains/api/rate-limit')
    const { checkContactEmailSendRateLimit } = await import('@/lib/server/auth/signin-rate-limit')
    const ip = getClientIp(getRequestHeaders())
    const limit = await checkContactEmailSendRateLimit(ip, ctx.principal.id)
    if (!limit.allowed) {
      throw new ValidationError(
        'RATE_LIMITED',
        'Too many confirmation emails. Try again a little later.'
      )
    }

    const challenge = buildContactEmailChallenge(ctx.principal.id, email)

    const { db, verification } = await import('@/lib/server/db')
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: challenge.identifier,
      value: challenge.value,
      expiresAt: challenge.expiresAt,
    })

    const { config } = await import('@/lib/server/config')
    const { sendConfirmContactEmail } = await import('@quackback/email')
    const settings = await db.query.settings.findFirst()
    await sendConfirmContactEmail({
      to: email,
      confirmUrl: `${config.baseUrl}/auth/confirm-contact?token=${encodeURIComponent(challenge.token)}`,
      workspaceName: settings?.name ?? undefined,
    })

    return { ok: true as const }
  })

/**
 * Confirm a challenge and write the address.
 *
 * Deliberately NOT bound to the current session: the link is opened from a mail
 * client, routinely on a different device from the one that asked. The token is
 * the proof, it is single-use, and confirming only ever writes the address the
 * principal already requested.
 */
export const confirmContactEmailFn = createServerFn({ method: 'POST' })
  .validator(confirmSchema)
  .handler(async ({ data }) => {
    const { contactEmailIdentifier, readContactEmailChallenge } =
      await import('@/lib/server/domains/principals/contact-email')
    const { db, verification, principal, eq } = await import('@/lib/server/db')

    const identifier = contactEmailIdentifier(data.token)
    const row = await db.query.verification.findFirst({
      where: eq(verification.identifier, identifier),
    })
    // Consume first, so a token cannot be replayed even if what follows fails.
    if (row) await db.delete(verification).where(eq(verification.identifier, identifier))

    if (!row || row.expiresAt.getTime() <= Date.now()) {
      return { ok: false as const, reason: 'expired' as const }
    }
    const challenge = readContactEmailChallenge(row.value)
    if (!challenge) {
      return { ok: false as const, reason: 'expired' as const }
    }

    await db
      .update(principal)
      .set({ contactEmail: challenge.email })
      .where(eq(principal.id, challenge.principalId as never))

    return { ok: true as const, email: challenge.email }
  })
