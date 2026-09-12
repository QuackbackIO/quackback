/**
 * Short-lived signed tokens that authorize an SSE stream handshake.
 *
 * EventSource cannot set an Authorization header, and the widget authenticates
 * with an in-memory Bearer token (never a cookie), so the stream URL must carry
 * a credential. Rather than putting the long-lived session token in the URL
 * (logs, referrers), the widget mints a short-lived token bound to its current
 * principal via an authenticated server function and passes that. The token is
 * an HMAC over `${principalId}.${expiry}` — it proves "this principal was
 * authenticated at mint time", which is all the stream needs to authorize a
 * subscription (the conversation-level access check still runs server-side).
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { activeSecretKey } from '../secret-key'
import type { PrincipalId } from '@quackback/ids'
import { toSessionScope, type SessionScope } from '@/lib/shared/roles'

// Short TTL: the token only authorizes the initial SSE handshake, and the
// client re-mints via the authenticated mint fn on every reconnect — so a
// revoked/logged-out session stops being able to (re)establish a stream within
// this window.
const DEFAULT_TTL_MS = 2 * 60 * 1000

// Domain-separation tag mixed into the HMAC so a token signed for another
// purpose with the same secret key can never be cross-accepted as a stream
// token, regardless of payload shape.
const DOMAIN_TAG = 'chat-stream:v1\n'

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(payload: string): string {
  return createHmac('sha256', activeSecretKey())
    .update(DOMAIN_TAG + payload)
    .digest('base64url')
}

export interface VerifiedStreamToken {
  principalId: PrincipalId
  scope: SessionScope
}

/** Mint a stream token for a principal, valid for `ttlMs` (default 2 min). */
export function mintStreamToken(
  principalId: PrincipalId,
  scope: SessionScope = 'dashboard',
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const payload = `${principalId}.${scope}.${Date.now() + ttlMs}`
  return `${b64url(payload)}.${sign(payload)}`
}

/** Verify a stream token, returning its principal and audience or null if invalid/expired. */
export function verifyStreamToken(token: string | null | undefined): VerifiedStreamToken | null {
  if (!token) return null
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

  const sep = payload.lastIndexOf('.')
  if (sep <= 0) return null
  const exp = Number(payload.slice(sep + 1))
  if (!Number.isFinite(exp) || Date.now() > exp) return null

  // `${principalId}.${scope}.${exp}`; legacy `${principalId}.${exp}` is dashboard.
  const withoutExpiry = payload.slice(0, sep)
  const scopeSep = withoutExpiry.lastIndexOf('.')
  if (scopeSep <= 0) {
    return { principalId: withoutExpiry as PrincipalId, scope: 'dashboard' }
  }
  return {
    principalId: withoutExpiry.slice(0, scopeSep) as PrincipalId,
    scope: toSessionScope(withoutExpiry.slice(scopeSep + 1)),
  }
}
