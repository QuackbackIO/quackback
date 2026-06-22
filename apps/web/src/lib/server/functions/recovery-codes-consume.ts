/**
 * Public recovery-code sign-in path.
 *
 * Email + code → verify → mark used → mint magic-link verify URL the
 * caller can redirect to. Constant-time across all failure modes
 * (unknown email, wrong code, no active codes) — we always perform at
 * least one scrypt compare so timing-side-channel email enumeration
 * doesn't work.
 *
 * Audit log entries:
 *  - sso.recovery_codes.used (success)
 *  - auth.method.blocked (failure, with metadata.reason)
 *
 * Rate-limiting happens at the route layer (B.6) where the IP is
 * available without re-reading headers.
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { SsoRecoveryCodeId } from '@quackback/ids'
import { and, db, eq, isNull, sql, ssoRecoveryCode, user } from '@/lib/server/db'
import { recordAuditEvent } from '@/lib/server/audit/log'
import { hashRecoveryCode, verifyRecoveryCode } from '@/lib/server/auth/recovery-codes'
import { mintMagicLinkUrl } from '@/lib/server/auth/magic-link-mint'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { bucketRetryAfter, incrementBucket } from '@/lib/server/utils/redis-rate-bucket'
import { resolvePublicBaseUrl } from '@/lib/server/public-url'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'recovery' })

const consumeRecoveryCodeInput = z.object({
  email: z.string().email(),
  code: z.string().min(1).max(64),
})

type ConsumeResult = { ok: true; redirectUrl: string } | { ok: false; error: string }

/**
 * 5 attempts per 5 minutes per (ip, email). Both success and failure
 * count toward the cap, matching GitHub / Linear practice. Combined
 * with the 60-bit recovery-code entropy this makes blind brute-force
 * impractical. Fail-open on Redis errors via the shared bucket
 * primitive.
 */
const RECOVERY_ATTEMPT_LIMIT = 5
const RECOVERY_WINDOW_SECONDS = 5 * 60

async function checkRecoveryRateLimit(
  ip: string,
  email: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const spec = { key: `recovery:attempt:${ip}:${email}`, windowSeconds: RECOVERY_WINDOW_SECONDS }
  const { count } = await incrementBucket(spec)
  if (count === null) return { allowed: true }
  if (count > RECOVERY_ATTEMPT_LIMIT) {
    return { allowed: false, retryAfter: await bucketRetryAfter(spec) }
  }
  return { allowed: true }
}

/**
 * Compute a fake hash once so the unknown-email branch spends the same
 * scrypt cost as the matching branch — avoids a measurable timing
 * difference between "email exists" and "email doesn't exist".
 */
let fakeHashPromise: Promise<string> | null = null
function getFakeHash(): Promise<string> {
  if (!fakeHashPromise) {
    fakeHashPromise = hashRecoveryCode('FAKE-FAKE-FAKE')
  }
  return fakeHashPromise
}

export const consumeRecoveryCodeFn = createServerFn({ method: 'POST' })
  .validator(consumeRecoveryCodeInput)
  .handler(async ({ data }): Promise<ConsumeResult> => {
    const headers = getRequestHeaders()
    const actor = { email: data.email }
    const normalizedEmail = data.email.trim().toLowerCase()
    const ip = getClientIp(headers)

    // Rate-limit BEFORE any DB / scrypt work so a flooding attacker
    // can't impose load on the system.
    const rate = await checkRecoveryRateLimit(ip, normalizedEmail)
    if (!rate.allowed) {
      await recordAuditEvent({
        event: 'auth.method.blocked',
        outcome: 'failure',
        actor,
        headers,
        metadata: {
          method: 'recovery_code',
          reason: 'rate_limited',
          retryAfter: rate.retryAfter,
        },
      })
      return { ok: false, error: 'rate_limited' }
    }

    // Case-insensitive email lookup. The rate-limit bucket already
    // keyed on normalizedEmail; using the un-normalised input here let
    // an admin whose user row stored "Alice@example.com" be locked out
    // of break-glass when they typed "alice@example.com". LOWER both
    // sides matches the on-write normalisation Better Auth performs.
    const userRow = await db.query.user.findFirst({
      where: sql`LOWER(${user.email}) = ${normalizedEmail}`,
      columns: { id: true, email: true },
    })

    if (!userRow) {
      // Constant-time: still do one verify so the response time matches
      // the "user exists but code doesn't" branch.
      await verifyRecoveryCode(data.code, await getFakeHash())
      await recordAuditEvent({
        event: 'auth.method.blocked',
        outcome: 'failure',
        actor,
        headers,
        metadata: { method: 'recovery_code', reason: 'unknown_email' },
      })
      return { ok: false, error: 'invalid_credentials' }
    }

    const activeCodes = await db.query.ssoRecoveryCode.findMany({
      where: and(eq(ssoRecoveryCode.userId, userRow.id), isNull(ssoRecoveryCode.usedAt)),
      columns: { id: true, codeHash: true },
    })

    let matchedId: string | null = null
    for (const row of activeCodes) {
      // Run every verify (even after a match) so timing doesn't reveal
      // which code matched.
      const ok = await verifyRecoveryCode(data.code, row.codeHash)
      if (ok && !matchedId) matchedId = row.id
    }

    // If no codes existed at all, still spend one scrypt so the "user
    // exists but has no active codes" branch matches the "user exists
    // with codes but none match" branch in cost.
    if (activeCodes.length === 0) {
      await verifyRecoveryCode(data.code, await getFakeHash())
    }

    if (!matchedId) {
      await recordAuditEvent({
        event: 'auth.method.blocked',
        outcome: 'failure',
        actor: { userId: userRow.id, email: userRow.email },
        headers,
        metadata: { method: 'recovery_code', reason: 'invalid_code' },
      })
      return { ok: false, error: 'invalid_credentials' }
    }

    await db
      .update(ssoRecoveryCode)
      .set({ usedAt: new Date() })
      .where(eq(ssoRecoveryCode.id, matchedId as SsoRecoveryCodeId))

    const { url: redirectUrl } = await mintMagicLinkUrl({
      email: data.email,
      callbackPath: '/admin',
      errorCallbackPath: '/admin/login',
      portalUrl: resolvePublicBaseUrl(headers),
    })

    await recordAuditEvent({
      event: 'sso.recovery_codes.used',
      outcome: 'success',
      actor: { userId: userRow.id, email: userRow.email },
      headers,
      target: { type: 'sso_recovery_code', id: matchedId },
    })

    // Fire-and-forget security-alert email. We don't await — a slow
    // SMTP transport shouldn't delay the user's redirect. Failures
    // are logged inside sendRecoveryCodeUsedEmail's error path; the
    // user still sees the audit row server-side.
    void sendRecoveryCodeAlert({
      email: userRow.email ?? data.email,
      headers,
      occurredAt: new Date(),
    })

    return { ok: true, redirectUrl }
  })

async function sendRecoveryCodeAlert(opts: {
  email: string
  headers: Headers
  occurredAt: Date
}): Promise<void> {
  try {
    const { sendRecoveryCodeUsedEmail, isEmailConfigured } = await import('@quackback/email')
    if (!isEmailConfigured()) return

    const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
    const tenant = await getTenantSettings()

    await sendRecoveryCodeUsedEmail({
      to: opts.email,
      workspaceName: tenant?.settings?.name,
      ipAddress: getClientIp(opts.headers) || null,
      userAgent: opts.headers.get('user-agent'),
      occurredAt: opts.occurredAt.toUTCString(),
    })
  } catch (error) {
    log.error({ err: error }, 'failed to send security alert email')
  }
}
