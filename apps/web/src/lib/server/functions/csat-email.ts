/**
 * CSAT-over-email (support platform's CSAT-over-email extension): the
 * HMAC-signed link token a rating-request email's 5 emoji links share, and
 * the token-authorized fns the public `/csat` route calls to record a
 * rating/comment. NOT `requireAuth`-gated — a visitor clicks these links from
 * their inbox with no session, so the token itself is the sole credential
 * (mirrors unsubscribe's `processUnsubscribeTokenFn` — a plain, unauthenticated
 * server fn that trusts a signed/looked-up token instead of a session).
 *
 * The signing scheme mirrors realtime/stream-token.ts's mintStreamToken /
 * verifyStreamToken (a domain-separated HMAC-SHA256 over a dot-joined
 * payload, keyed on `config.secretKey`) rather than conversation.email-channel.ts's
 * signConversationId — that one needs EMAIL_INBOUND_SIGNING_SECRET configured,
 * which isn't a prerequisite CSAT-over-email should share, and it only signs a
 * bare conversation id, not a (conversationId, principalId, expiry) triple.
 *
 * The payload binds conversationId + the visitor principal id + an expiry (30
 * days); the rating itself is a plain `?rating=1..5` query param on the link,
 * NOT inside the token, so the same token backs all 5 emoji links in one email.
 * Mint lives alongside verify/record here (rather than split across files) so
 * the HMAC scheme has exactly one owner — action.executor.ts's send_block csat
 * path imports `mintCsatEmailToken` from here when composing the email.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'csat-email' })

const DOMAIN_TAG = 'csat-email:v1\n'
const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(payload: string): string {
  return createHmac('sha256', config.secretKey)
    .update(DOMAIN_TAG + payload)
    .digest('base64url')
}

/** Mint a CSAT-over-email link token, valid for `ttlMs` (default 30 days). */
export function mintCsatEmailToken(
  conversationId: ConversationId,
  principalId: PrincipalId,
  ttlMs: number = DEFAULT_TOKEN_TTL_MS
): string {
  const payload = `${conversationId}.${principalId}.${Date.now() + ttlMs}`
  return `${b64url(payload)}.${sign(payload)}`
}

interface CsatEmailTokenClaims {
  conversationId: ConversationId
  principalId: PrincipalId
}

/** Verify a CSAT-over-email token, returning its claims or null when
 *  missing/tampered/expired — the caller renders one generic friendly error
 *  state for all three (no stack traces, no "expired" vs "invalid" split). */
function verifyCsatEmailToken(token: string): CsatEmailTokenClaims | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const encodedPayload = token.slice(0, dot)
  const providedSig = token.slice(dot + 1)

  let payload: string
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const expectedSig = sign(payload)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const parts = payload.split('.')
  if (parts.length !== 3) return null
  const [conversationId, principalId, expStr] = parts as [string, string, string]
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return null

  return {
    conversationId: conversationId as ConversationId,
    principalId: principalId as PrincipalId,
  }
}

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

const recordCsatViaTokenSchema = z.object({
  token: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  /** Present only on the thanks page's optional follow-up comment submit —
   *  the initial rating click never carries one. recordCsat's own contract
   *  (latest-wins) makes re-submitting the same rating alongside a comment a
   *  safe, idempotent no-op on the rating itself. */
  comment: z.string().max(2000).optional(),
})

/**
 * Record a rating (and optionally a comment) via a CSAT-over-email token —
 * the `/csat` route's loader calls this with just `{ token, rating }` on the
 * initial link click, and again with `{ token, rating, comment }` when the
 * thanks page's optional comment box is submitted (the rating query param
 * travels with the page, since the token alone doesn't carry it — see the
 * module doc). Idempotent: recordCsat's latest-wins contract means re-clicking
 * a link, or submitting a comment after the fact, simply re-records.
 */
export const recordCsatViaTokenFn = createServerFn({ method: 'POST' })
  .validator(recordCsatViaTokenSchema)
  .handler(async ({ data }): Promise<CsatEmailResult> => {
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
