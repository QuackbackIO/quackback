/**
 * Refresh-token rotation grace ("heal") for the OAuth 2.1 provider.
 *
 * TEMPORARY WORKAROUND — delete this module once better-auth ships a native
 * rotation grace window. Tracked upstream:
 * https://github.com/better-auth/better-auth/issues/8512
 *
 * Why: `@better-auth/oauth-provider` rotates the refresh token on every
 * refresh and treats any reuse of a rotated token as theft, deleting the
 * entire token family for that (client, user) pair. MCP clients routinely
 * present rotated tokens for benign reasons — concurrent sessions sharing
 * one credentials file, a crash before persisting the new token, a lost
 * response — and each occurrence forces the user back through interactive
 * authorization.
 *
 * Mechanism: a `hooks.before` pass on `/oauth2/token`. When the presented
 * refresh token is revoked, we heal it (set `revoked = null`) only if ALL of:
 *
 *  - the revocation happened within the grace window
 *    (`OAUTH_REFRESH_GRACE_SECONDS`, default 7 days, 0 disables), and
 *  - the revocation is evidenced as a *rotation*: the plugin stamps the old
 *    row's `revoked` and the successor row's `createdAt` from the same
 *    `iat`, so a successor row with `createdAt == revoked` exists for the
 *    same (client, user) — and that successor is still active. Deliberate
 *    revocations (RFC 7009 `/oauth2/revoke`) set `revoked` without creating
 *    a successor and are therefore never healed — reusing those still
 *    triggers the plugin's family revocation. A successor that was itself
 *    later revoked is likewise not evidence: healing its predecessor would
 *    resurrect a chain the user/client deliberately killed.
 *
 * Client identity is resolved the way the provider resolves it: a Basic
 * `Authorization` header (confidential `client_secret_basic` clients, the
 * RFC 7591 registration default) takes precedence over `client_id` in the
 * form body.
 *
 * The plugin then processes the request unmodified: it finds a valid token,
 * rotates it, and issues a fresh pair. We never mint tokens, never widen
 * scopes (the healed row keeps its own scopes, re-validated by the plugin),
 * and never un-revoke anything without rotation evidence. Within the window
 * this intentionally lets one previous-generation token chain stay usable —
 * the same trade-off as Auth0's rotation overlap period and Cloudflare's
 * dual-valid refresh tokens, accepted here because the alternative strands
 * every legitimate multi-session MCP client. Each heal is audit-logged.
 */
import { createHash } from 'node:crypto'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { db, oauthRefreshToken, eq, and, isNull } from '@/lib/server/db'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'refresh-grace' })

/**
 * Mirror of the oauth-provider's `storeTokens: 'hashed'` default
 * (SHA-256 → unpadded base64url). Frozen by a unit-test vector; the plugin
 * has no public export for it.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/**
 * Mirror of the provider's `basicToClientCredentials`: a Basic
 * `Authorization` header carries `client_id:client_secret` and takes
 * precedence over body credentials (`client_secret_basic` clients send no
 * `client_id` in the form body at all). Returns null on a malformed header
 * — the provider rejects those with `invalid_client` before any token
 * lookup, so there is never anything to heal.
 */
function basicAuthClientId(authorization: string): string | null {
  const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf-8')
  const separatorIndex = decoded.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) return null
  return decoded.slice(0, separatorIndex)
}

/**
 * Heal a benignly-stale refresh token before the oauth-provider's
 * refresh-grant handler sees it. No-op for everything except a
 * rotation-evidenced, in-grace, unexpired token owned by the requesting
 * client. Fails open: any internal error restores vanilla plugin behavior.
 */
export async function handleRefreshGraceHeal(ctx: {
  path?: string
  body?: unknown
  request?: { headers: { get(name: string): string | null } }
}): Promise<void> {
  if (ctx.path !== '/oauth2/token') return

  const body = ctx.body as Record<string, unknown> | undefined
  if (!body || body.grant_type !== 'refresh_token') return

  const wireToken = typeof body.refresh_token === 'string' ? body.refresh_token : null
  let clientId = typeof body.client_id === 'string' ? body.client_id : null
  const authorization = ctx.request?.headers.get('authorization') ?? null
  if (authorization?.startsWith('Basic ')) {
    clientId = basicAuthClientId(authorization)
  }
  // Missing credentials: the plugin rejects these without family fallout.
  if (!wireToken || !clientId) return

  const graceMs = Math.max(0, config.oauthRefreshGraceSeconds) * 1000
  if (graceMs === 0) return

  try {
    const presented = await db.query.oauthRefreshToken.findFirst({
      where: eq(oauthRefreshToken.token, hashRefreshToken(wireToken)),
    })
    // Unknown or still-valid token → vanilla handling.
    if (!presented?.revoked) return
    // Wrong client → plugin rejects with invalid_client before any revocation.
    if (presented.clientId !== clientId) return

    const now = Date.now()
    // Expired tokens are rejected by the plugin before its reuse check —
    // healing one would *create* the family-revocation path it skips today.
    if (presented.expiresAt && presented.expiresAt.getTime() <= now) return
    if (now - presented.revoked.getTime() > graceMs) return

    // Rotation evidence: the successor row minted in the same rotation call,
    // still active. Absent for RFC 7009 revocations — those stay revoked.
    // The successor must itself be un-revoked: if it was deliberately
    // revoked after the rotation, healing its predecessor would resurrect
    // access the user/client explicitly killed.
    const successor = await db.query.oauthRefreshToken.findFirst({
      where: and(
        eq(oauthRefreshToken.clientId, presented.clientId),
        eq(oauthRefreshToken.userId, presented.userId),
        eq(oauthRefreshToken.createdAt, presented.revoked),
        isNull(oauthRefreshToken.revoked)
      ),
      columns: { id: true },
    })
    if (!successor) return

    await db
      .update(oauthRefreshToken)
      .set({ revoked: null })
      .where(eq(oauthRefreshToken.id, presented.id))

    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    await recordAuditEvent({
      event: 'oauth.refresh_token.grace_heal',
      actor: { userId: presented.userId },
      headers: getRequestHeaders(),
      target: { type: 'oauth_client', id: presented.clientId },
      metadata: {
        refreshTokenId: presented.id,
        revokedAgoMs: now - presented.revoked.getTime(),
        scopes: presented.scopes,
      },
    })
  } catch (err) {
    // Fail open: grace is an availability optimization — on error the
    // request proceeds with the plugin's vanilla (strict) behavior.
    log.error({ err }, 'heal pass failed; falling back to strict rotation')
  }
}
