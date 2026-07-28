/**
 * Setting and changing a signed-in person's email address.
 *
 * `user.email` is the account's identity: sign-in resolves by it, portal access
 * grants on it, dedup matches on it. So this is the only place it is written
 * for a signed-in person, and every write is preceded by proof of control.
 *
 * Two shapes, and the difference is not a preference:
 *
 *   no reachable address    a first-time SET. There is nothing at the current
 *                           address to protect and nobody to notify, because
 *                           the current address is a placeholder that cannot
 *                           receive mail. One code, to the new address.
 *
 *   a real address          a CHANGE. Two proofs: a code at the current address
 *                           first, so a stolen session cannot silently rebind
 *                           the account, then a code at the new one.
 *
 * Requiring the current-address code in both cases would lock out exactly the
 * people this exists for — someone whose provider releases no email has no
 * reachable current address by definition. Better Auth's `verifyCurrentEmail`
 * is a static boolean and cannot express that, which is why the step is
 * enforced here rather than in the plugin config.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { requireAuth } from './auth-helpers'
import { ValidationError } from '@/lib/shared/errors'
import { realEmail } from '@/lib/shared/anonymous-email'

const confirmSchema = z.object({ email: z.string().max(320), code: z.string().min(1).max(16) })

/**
 * The signed-in user's row.
 *
 * Takes the auth context rather than calling `requireAuth` itself, so each
 * server function below holds its own gate. The authz matrix attributes a gate
 * to the function that calls it, and a shared helper would collapse four named
 * surfaces into one private one that tells a reviewer nothing.
 *
 * Re-reads rather than trusting `ctx.user.email`: the session is built once and
 * this flow's whole job is changing that value, so a stale copy would let a
 * later request skip the current-address step it should have required.
 */
async function userRow(ctx: Awaited<ReturnType<typeof requireAuth>>) {
  const { db, user, eq } = await import('@/lib/server/db')
  const row = await db.query.user.findFirst({
    where: eq(user.id, ctx.user.id),
    columns: { id: true, email: true },
  })
  if (!row) throw new ValidationError('NOT_FOUND', 'No account found for this session.')
  return row
}

/**
 * Whether this account already has a reachable address, which decides whether
 * a current-address code is required. A placeholder is not reachable.
 */
export const getEmailChangeStateFn = createServerFn({ method: 'GET' }).handler(async () => {
  const row = await userRow(await requireAuth())
  const current = realEmail(row.email)
  return { currentEmail: current, requiresCurrentCode: current !== null }
})

/**
 * Step 0, only for an account that already has a reachable address: send a code
 * to it. Proves the person holds the address they are moving away from.
 */
export const sendCurrentAddressCodeFn = createServerFn({ method: 'POST' }).handler(async () => {
  const row = await userRow(await requireAuth())
  const current = realEmail(row.email)
  if (!current) {
    throw new ValidationError('NO_CURRENT_EMAIL', 'This account has no confirmed address yet.')
  }
  const { getAuth } = await import('@/lib/server/auth')
  const auth = await getAuth()
  await auth.api.sendVerificationOTP({
    body: { email: current, type: 'email-verification' },
    headers: getRequestHeaders(),
  })
  return { ok: true as const }
})

/**
 * Step 1: send a code to the address being claimed.
 *
 * The current-address code is required here — before anything is sent to the
 * new address — when the account has a reachable address. Checking it later
 * would mean a stolen session could still cause mail to be sent to an address
 * of the attacker's choosing.
 */
export const requestEmailChangeFn = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().max(320), currentCode: z.string().max(16).optional() }))
  .handler(async ({ data }) => {
    const row = await userRow(await requireAuth())
    const { acceptableContactEmail } = await import('@/lib/server/domains/principals/contact-email')
    const email = acceptableContactEmail(data.email)
    if (!email) throw new ValidationError('VALIDATION_ERROR', 'Enter a valid email address.')

    const current = realEmail(row.email)
    if (current && current.toLowerCase() === email) {
      throw new ValidationError('SAME_EMAIL', 'That is already your email address.')
    }

    const { getClientIp } = await import('@/lib/server/domains/api/rate-limit')
    const { checkContactEmailSendRateLimit } = await import('@/lib/server/auth/signin-rate-limit')
    const headers = getRequestHeaders()
    const limit = await checkContactEmailSendRateLimit(getClientIp(headers), row.id)
    if (!limit.allowed) {
      throw new ValidationError('RATE_LIMITED', 'Too many attempts. Try again a little later.')
    }

    const { getAuth } = await import('@/lib/server/auth')
    const auth = await getAuth()

    // The conditional second factor. Verified BEFORE the new address is mailed.
    if (current) {
      if (!data.currentCode) {
        throw new ValidationError('CURRENT_CODE_REQUIRED', 'Confirm your current address first.')
      }
      const ok = await auth.api
        .checkVerificationOTP({
          body: { email: current, otp: data.currentCode, type: 'email-verification' },
          headers,
        })
        .then(
          (r: unknown) => (r as { success?: boolean } | null)?.success !== false,
          () => false
        )
      if (!ok) throw new ValidationError('INVALID_CODE', 'That code is not right or has expired.')
    }

    // Whether the address is already held is deliberately NOT reported back.
    // The reply is visible to whoever asked, and they may not own the address.
    const { db, user, sql } = await import('@/lib/server/db')
    const holder = await db.query.user.findFirst({
      // `user_email_idx` is case-SENSITIVE while addresses are normalised
      // lowercase, so an equality match would miss a mixed-case duplicate and
      // let a second identity exist for one address.
      where: sql`LOWER(${user.email}) = ${email}`,
      columns: { id: true },
    })
    if (holder && holder.id !== row.id) {
      return { ok: true as const }
    }

    await auth.api.sendVerificationOTP({
      body: { email, type: 'email-verification' },
      headers,
    })
    return { ok: true as const }
  })

/**
 * Step 2: the code proves the new address, so write it.
 *
 * Better Auth owns the write, the uniqueness conflict and `emailVerified`; this
 * only translates its failure into something the UI can say.
 */
export const confirmEmailChangeFn = createServerFn({ method: 'POST' })
  .validator(confirmSchema)
  .handler(async ({ data }) => {
    await requireAuth()
    const { acceptableContactEmail } = await import('@/lib/server/domains/principals/contact-email')
    const email = acceptableContactEmail(data.email)
    if (!email) throw new ValidationError('VALIDATION_ERROR', 'Enter a valid email address.')

    const { getAuth } = await import('@/lib/server/auth')
    const auth = await getAuth()
    try {
      await auth.api.changeEmailEmailOTP({
        body: { newEmail: email, otp: data.code },
        headers: getRequestHeaders(),
      })
    } catch {
      // Either the code is wrong or the address was claimed inside the window.
      // Both are "try again", and distinguishing them would leak whether an
      // account holds the address.
      return { ok: false as const, reason: 'invalid_or_taken' as const }
    }
    return { ok: true as const, email }
  })
