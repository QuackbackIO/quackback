/**
 * CSAT-over-email link tokens (support platform's CSAT-over-email extension):
 * the HMAC-signed credential a rating-request email's 5 emoji links share.
 * Lives in `lib/server` (NOT the server-fn file) because it needs node's
 * `crypto` at module scope — a server-fn module is client-visible, so a bare
 * node built-in import there leaks into the browser bundle and crashes
 * hydration ("Module crypto has been externalized"); the `@/lib/server/*`
 * specifier is what the build protects, so this is where the crypto lives.
 *
 * The signing scheme mirrors realtime/stream-token.ts's mintStreamToken /
 * verifyStreamToken (a domain-separated HMAC-SHA256 over a dot-joined
 * payload, keyed on `config.secretKey`) rather than
 * conversation.email-channel.ts's signConversationId — that one needs
 * EMAIL_INBOUND_SIGNING_SECRET configured, which isn't a prerequisite
 * CSAT-over-email should share, and it only signs a bare conversation id,
 * not a (conversationId, principalId, expiry) triple.
 *
 * The payload binds conversationId + the visitor principal id + an expiry
 * (30 days); the rating itself is a plain `?rating=1..5` query param on the
 * link, NOT inside the token, so the same token backs all 5 emoji links in
 * one email. Mint and verify live together so the HMAC scheme has exactly
 * one owner — action.executor.ts's send_block csat path mints, and
 * functions/csat-email.ts's record fn verifies.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { config } from '@/lib/server/config'

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

export interface CsatEmailTokenClaims {
  conversationId: ConversationId
  principalId: PrincipalId
}

/** Verify a CSAT-over-email token, returning its claims or null when
 *  missing/tampered/expired — the caller renders one generic friendly error
 *  state for all three (no stack traces, no "expired" vs "invalid" split). */
export function verifyCsatEmailToken(token: string): CsatEmailTokenClaims | null {
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
