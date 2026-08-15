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

async function verifyOttCookies(
  ott: string,
  returnTo: string,
  headers?: Headers
): Promise<OriginTransferResult> {
  try {
    const { auth } = await import('@/lib/server/auth')
    const requestHeaders = new Headers(headers)
    requestHeaders.delete('content-length')
    requestHeaders.set('content-type', 'application/json')
    const response = await auth.handler(
      new Request('http://auth.local/api/auth/one-time-token/verify', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ token: ott }),
      })
    )
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

/**
 * Consume the control-plane Open handoff. First arrival uses the immutable
 * system host and may happen before the identity projection lands, so this
 * path must not require a verified projection. Replay and expiry fail closed
 * inside Better Auth's verify.
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
  return consumeOrContinueExistingSession(input.ott, '/', input.headers)
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
