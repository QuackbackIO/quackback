/**
 * CSAT-over-email (support platform's CSAT-over-email extension): the
 * token-authorized fns the public `/csat` route calls. NOT `requireAuth`-gated
 * — a visitor clicks these links from their inbox with no session, so the
 * token itself is the sole credential (mirrors unsubscribe's
 * `processUnsubscribeTokenFn` — a plain, unauthenticated server fn that
 * trusts a signed/looked-up token instead of a session).
 *
 * The token scheme itself (mint + verify, node `crypto`) lives in
 * `@/lib/server/domains/conversation/csat-email-token` — NOT here, because a
 * server-fn module is client-visible and a top-level node built-in import
 * here leaks `crypto` into the browser bundle and crashes hydration. This
 * file only dynamically imports the verifier inside its handlers.
 *
 * Recording is deliberately split from page load: `validateCsatEmailTokenFn`
 * is the read-only check the route's loader runs (safe against mail-scanner
 * link prefetch — corporate email security products crawl every link in an
 * email, and a loader that wrote the rating would let a scanner silently
 * submit a CSAT score). `recordCsatViaTokenFn` only
 * ever runs from an explicit click on the rendered page.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { Actor } from '@/lib/server/policy/types'
import { logger } from '@/lib/server/logger'
import type { CsatEmailTokenClaims } from '@/lib/server/domains/conversation/csat-email-token'

const log = logger.child({ component: 'csat-email' })

/** The token's principal, as the visitor-scoped Actor `recordCsat` requires —
 *  the identical construction workflow.engine.ts's `visitorActor` uses for the
 *  engine's own `record_csat` action (not imported: that one is private to
 *  its module), so a CSAT-over-email submission is authorized exactly the way
 *  an in-app rating is. */
function visitorActorFromClaims(claims: CsatEmailTokenClaims): Actor {
  return {
    principalId: claims.principalId,
    role: null,
    principalType: 'anonymous',
    segmentIds: new Set(),
  }
}

export type CsatEmailResult = { success: true } | { success: false; error: 'invalid' | 'failed' }

/**
 * Read-only token check for the `/csat` route's loader: is this link still
 * good? Writes NOTHING — the loader runs on a bare GET, which mail scanners
 * trigger by prefetching links (see the module doc). The page then records
 * only on an explicit face click.
 */
export const validateCsatEmailTokenFn = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ valid: boolean }> => {
    const { verifyCsatEmailToken } =
      await import('@/lib/server/domains/conversation/csat-email-token')
    return { valid: verifyCsatEmailToken(data.token) !== null }
  })

const recordCsatViaTokenSchema = z.object({
  token: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  /** Present only on the thanks view's optional follow-up comment submit —
   *  the initial face click never carries one. recordCsat's own contract
   *  keeps the first score immutable, making the comment follow-up idempotent. */
  comment: z.string().max(2000).optional(),
})

/**
 * Record a rating (and optionally a comment) via a CSAT-over-email token —
 * called from the `/csat` page's face click, and again with a `comment` when
 * the thanks view's optional comment box is submitted. Never called from a
 * loader (see the module doc's scanner rationale). Idempotent: recordCsat's
 * latest-wins contract means re-clicking a face, or commenting after the
 * fact, leaves the first score in place while still accepting the comment.
 */
export const recordCsatViaTokenFn = createServerFn({ method: 'POST' })
  .validator(recordCsatViaTokenSchema)
  .handler(async ({ data }): Promise<CsatEmailResult> => {
    const { verifyCsatEmailToken } =
      await import('@/lib/server/domains/conversation/csat-email-token')
    const claims = verifyCsatEmailToken(data.token)
    if (!claims) {
      log.debug('csat email token invalid or expired')
      return { success: false, error: 'invalid' }
    }
    try {
      const { recordCsat } = await import('@/lib/server/domains/conversation/conversation.service')
      await recordCsat(
        claims.conversationId,
        data.rating,
        data.comment,
        visitorActorFromClaims(claims)
      )
      return { success: true }
    } catch (err) {
      log.error({ err }, 'record csat via email token failed')
      return { success: false, error: 'failed' }
    }
  })
