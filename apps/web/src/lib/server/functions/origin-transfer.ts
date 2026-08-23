import { isSafeCallbackUrl } from '@/lib/shared/routing'

export type OriginTransferResult =
  | { kind: 'redirect'; to: string; cookies: string[] }
  | { kind: 'error'; status: 'invalid' | 'error' }

export function isCanonicalIdentityHost(host: string | null, canonicalOrigin: string): boolean {
  if (!host) return false
  const requested = host.trim().toLowerCase().replace(/:\d+$/, '')
  return requested === new URL(canonicalOrigin).hostname
}

function responseCookies(response: Response): string[] {
  const fromGetter = response.headers.getSetCookie?.() ?? []
  if (fromGetter.length > 0) return fromGetter
  const single = response.headers.get('set-cookie')
  return single ? [single] : []
}

/**
 * Internal verify Request for a browser GET that arrived from another origin.
 *
 * Visit workspace is a control-plane POST that 302s here. The GET keeps
 * `Referer: https://app.quackback.io/…` and often a Cookie (CDN, prior
 * visit). Better Auth CSRF treats Referer as Origin when Origin is
 * absent, and refuses anything not on the workspace allowlist — so a
 * freshly minted OTT looks expired. Verify as this workspace instead.
 */
export function ottVerifyRequest(ott: string, headers?: Headers): Request {
  const requestHeaders = new Headers(headers)
  requestHeaders.delete('content-length')
  requestHeaders.delete('referer')
  requestHeaders.delete('origin')
  requestHeaders.set('content-type', 'application/json')

  const host = headers?.get('host')?.trim()
  const proto = (headers?.get('x-forwarded-proto') ?? 'https').split(',')[0]?.trim() || 'https'
  const origin = host ? `${proto}://${host}` : 'http://auth.local'
  requestHeaders.set('origin', origin)

  return new Request(`${origin}/api/auth/one-time-token/verify`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({ token: ott }),
  })
}

async function verifyOttCookies(
  ott: string,
  returnTo: string,
  headers?: Headers
): Promise<OriginTransferResult> {
  try {
    const { auth } = await import('@/lib/server/auth')
    const response = await auth.handler(ottVerifyRequest(ott, headers))
    if (!response.ok) return { kind: 'error', status: 'invalid' }
    const cookies = responseCookies(response)
    if (cookies.length === 0) return { kind: 'error', status: 'error' }
    return { kind: 'redirect', to: returnTo, cookies }
  } catch {
    return { kind: 'error', status: 'invalid' }
  }
}

/** Same-browser remount after a successful consume still has the session. */
async function continueIfAlreadySignedIn(
  returnTo: string,
  headers?: Headers
): Promise<OriginTransferResult> {
  if (!headers) return { kind: 'error', status: 'invalid' }
  try {
    const { auth } = await import('@/lib/server/auth')
    const session = await auth.api.getSession({ headers })
    if (session?.user) return { kind: 'redirect', to: returnTo, cookies: [] }
  } catch {
    // The token already failed closed; absence of a session stays invalid.
  }
  return { kind: 'error', status: 'invalid' }
}

async function consumeOrContinueExistingSession(
  ott: string,
  returnTo: string,
  headers?: Headers
): Promise<OriginTransferResult> {
  const verified = await verifyOttCookies(ott, returnTo, headers)
  if (verified.kind === 'redirect') return verified
  const existing = await continueIfAlreadySignedIn(returnTo, headers)
  return existing.kind === 'redirect' ? existing : verified
}

type OpenHandoffOttSnapshot = { ott: string; value: string; expiresAt: Date }

/**
 * Better Auth deletes the verification row on first verify. Open is a GET
 * the browser (and a prefetch) can hit twice, so we snapshot the row and
 * put it back for the rest of its TTL. Rename-transfer stays single-use.
 */
async function snapshotOpenHandoffOtt(ott: string): Promise<OpenHandoffOttSnapshot | null> {
  try {
    const { db, verification, eq } = await import('@/lib/server/db')
    const [row] = await db
      .select({ value: verification.value, expiresAt: verification.expiresAt })
      .from(verification)
      .where(eq(verification.identifier, `one-time-token:${ott}`))
      .limit(1)
    if (!row || row.expiresAt <= new Date()) return null
    return { ott, value: row.value, expiresAt: row.expiresAt }
  } catch {
    return null
  }
}

async function restoreOpenHandoffOtt(snapshot: OpenHandoffOttSnapshot): Promise<void> {
  try {
    const { db, verification, eq } = await import('@/lib/server/db')
    const [existing] = await db
      .select({ id: verification.id })
      .from(verification)
      .where(eq(verification.identifier, `one-time-token:${snapshot.ott}`))
      .limit(1)
    if (existing) return
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `one-time-token:${snapshot.ott}`,
      value: snapshot.value,
      expiresAt: snapshot.expiresAt,
    })
  } catch {
    // A missed restore still fails closed on the next GET; the first
    // response already carries the session cookie.
  }
}

/** Backoff while a parallel Open GET restores the OTT row it just consumed. */
const OPEN_HANDOFF_SNAPSHOT_RETRY_MS = [25, 50, 100] as const

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type OpenHandoffAttempt =
  | Extract<OriginTransferResult, { kind: 'redirect' }>
  | (Extract<OriginTransferResult, { kind: 'error' }> & { missedSnapshot: boolean })

async function consumeOpenHandoffOnce(ott: string, headers?: Headers): Promise<OpenHandoffAttempt> {
  const snapshot = await snapshotOpenHandoffOtt(ott)
  if (!snapshot) {
    const existing = await continueIfAlreadySignedIn('/', headers)
    if (existing.kind === 'redirect') return existing
    return { kind: 'error', status: 'invalid', missedSnapshot: true }
  }
  const first = await consumeOrContinueExistingSession(ott, '/', headers)
  if (first.kind === 'redirect') {
    await restoreOpenHandoffOtt(snapshot)
    return first
  }
  await restoreOpenHandoffOtt(snapshot)
  const retry = await verifyOttCookies(ott, '/', headers)
  if (retry.kind === 'redirect') {
    await restoreOpenHandoffOtt(snapshot)
    return retry
  }
  return { ...first, missedSnapshot: false }
}

/**
 * Consume the control-plane Open handoff. First arrival uses the immutable
 * system host and may happen before the identity projection lands, so this
 * path must not require a verified projection. The token stays redeemable
 * until it expires: Visit is a GET, and a second load must still sign in.
 *
 * Two GETs can overlap: the second snapshot can run after the first verify
 * deleted the row and before the first restore put it back. When the snapshot
 * misses, wait briefly and try again so the sibling restore can land.
 */
export async function consumeOpenHandoff(input: {
  ott?: string
  returnTo?: string
  headers?: Headers
}): Promise<OriginTransferResult> {
  // Always the workspace root. The root route sends incomplete setup to
  // /onboarding; a finished workspace stays on the portal. Do not honor a
  // caller returnTo — Open must not drop a finished workspace into the
  // wizard or /admin.
  if (!input.ott) return { kind: 'error', status: 'invalid' }
  const first = await consumeOpenHandoffOnce(input.ott, input.headers)
  if (first.kind === 'redirect') return first
  if (!first.missedSnapshot) return { kind: 'error', status: first.status }

  for (const delayMs of OPEN_HANDOFF_SNAPSHOT_RETRY_MS) {
    await wait(delayMs)
    const retry = await consumeOpenHandoffOnce(input.ott, input.headers)
    if (retry.kind === 'redirect') return retry
    if (!retry.missedSnapshot) return { kind: 'error', status: retry.status }
  }
  return { kind: 'error', status: first.status }
}

/**
 * Consume a one-use session handoff on the workspace's current canonical host.
 *
 * Replay, expiry, a missing identity projection, and a host that is not the
 * projected origin all fail closed. The token is not touched until the host
 * check passes, so a transfer presented on the old or system host can still
 * succeed on the new one.
 */
export async function consumeOriginTransfer(input: {
  ott?: string
  returnTo?: string
  host: string | null
  headers?: Headers
}): Promise<OriginTransferResult> {
  const returnTo = isSafeCallbackUrl(input.returnTo) ? input.returnTo : '/admin/settings/general'
  if (!input.ott) return { kind: 'error', status: 'invalid' }

  const { db, settings } = await import('@/lib/server/db')
  const { parseIdentityProjection } =
    await import('@/lib/server/domains/settings/cloud/identity-projection')
  const [row] = await db.select({ identity: settings.cloudIdentity }).from(settings).limit(1)
  const identity = parseIdentityProjection(row?.identity)
  if (!identity || !isCanonicalIdentityHost(input.host, identity.canonicalOrigin)) {
    return { kind: 'error', status: 'invalid' }
  }

  return consumeOrContinueExistingSession(input.ott, returnTo, input.headers)
}
