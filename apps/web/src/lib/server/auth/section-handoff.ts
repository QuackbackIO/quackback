/**
 * Signing in across section hosts: the server half of the handoff described
 * in lib/shared/section-handoff.ts. Three GET legs, each answering with a 302:
 *
 *   begin  (target) state cookie, then to the source's mint
 *   mint   (source) a single-use token bound to the target host and the state
 *   finish (target) burn the token, check host and state, install the session
 *
 * What each property rests on:
 *
 *  - Hosts. Every host is checked against this workspace's own: the primary
 *    domain and the routable section hosts (`getSectionOrigins`, the same
 *    table links and routing use). The request's host is the one the edge
 *    vouches for (`requestWorkspaceHost`), never a forwarded header. A token
 *    names the one host it may be finished on; on Cloud it also lives only in
 *    its own workspace's database.
 *  - Single use. The finish deletes the token row before looking at it, so a
 *    replay, an expired token, or one presented on the wrong host is spent.
 *    Tokens live TOKEN_TTL_MS and are stored as a SHA-256 hash.
 *  - Bound to the browser. The begin leg sets a random state in a `__Host-`
 *    cookie on the target; the token carries its hash. A token minted in an
 *    attacker's browser cannot sign a victim's browser in as the attacker.
 *  - The session cookie is installed by the auth library's own one-time-token
 *    verify (`verifyOttCookies`), so it has exactly the attributes of a
 *    normal sign-in and no Domain: host-only on the target. The inner token
 *    is made and spent inside this request and never leaves the server.
 *  - No leaks. Every leg answers `Referrer-Policy: no-referrer` and
 *    `Cache-Control: no-store`; the finish lands on returnTo, so the token is
 *    gone from the address bar and from history. Nothing here logs a token.
 *  - Failure lands on the target page signed out, never on an error page.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, db, eq, like, lt, verification } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { requestWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'
import { getSectionOrigins } from '@/lib/server/domains/settings/section-links'
import { normalizeHost } from '@/lib/shared/section-domains'
import {
  SECTION_HANDOFF_FINISH_PATH,
  SECTION_HANDOFF_MINT_PATH,
  handoffReturnTo,
} from '@/lib/shared/section-handoff'
import type { SectionOrigins } from '@/lib/shared/section-links'

const log = logger.child({ component: 'section-handoff' })

/** How long a minted token may wait for its finish. The legs are back-to-back redirects. */
const TOKEN_TTL_MS = 60 * 1000
/** How long the state cookie lives: the whole round trip, including a provider sign-in. */
const STATE_TTL_SECONDS = 10 * 60
/** The inner one-time token lives only for the verify call that spends it. */
const INNER_TTL_MS = 30 * 1000

const TOKEN_IDENTIFIER_PREFIX = 'section-handoff:'

/** The state cookie on an https host. `__Host-` pins it to the host: no Domain, Path=/, Secure. */
export const SECTION_STATE_COOKIE = '__Host-qb_section_handoff'
/** The same cookie on a plain-http development host, where `__Host-` is not allowed. */
const INSECURE_STATE_COOKIE = 'qb_section_handoff'

const SHA256_HEX = /^[0-9a-f]{64}$/

interface StoredHandoff {
  /** The session token being carried. */
  s: string
  /** The one host the token may be finished on. */
  h: string
  /** SHA-256 of the state the target set in its cookie. */
  b: string
}

/** This workspace's hosts a handoff may start from or land on: host to origin. */
export function handoffHosts(origins: SectionOrigins): Map<string, string> {
  const hosts = new Map<string, string>()
  for (const origin of new Set(Object.values(origins))) {
    try {
      const url = new URL(origin)
      const host = normalizeHost(url.host)
      if (host) hosts.set(host, url.origin)
    } catch {
      // A malformed origin cannot be a handoff host.
    }
  }
  return hosts
}

/**
 * What went wrong, without the error itself: a failed query's message carries
 * its parameters, and here those are session tokens and handoff tokens.
 */
function errorKind(err: unknown): { error_name: string } {
  return { error_name: err instanceof Error ? err.name : typeof err }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function sameHash(a: string, b: string): boolean {
  if (!SHA256_HEX.test(a) || !SHA256_HEX.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

function stateCookieName(secure: boolean): string {
  return secure ? SECTION_STATE_COOKIE : INSECURE_STATE_COOKIE
}

function stateCookie(value: string, secure: boolean, maxAge: number): string {
  const attributes = [
    `${stateCookieName(secure)}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

function isSecureOrigin(origin: string | undefined): boolean {
  return !origin || origin.startsWith('https:')
}

async function hasSession(headers: Headers): Promise<{ token: string } | null> {
  try {
    const { auth } = await import('@/lib/server/auth')
    const found = await auth.api.getSession({ headers })
    return found?.session?.token ? { token: found.session.token } : null
  } catch (err) {
    log.warn(errorKind(err), 'session lookup failed; treating the viewer as signed out')
    return null
  }
}

interface HandoffRequest {
  url: URL
  /** This request's host, as the edge vouches for it. */
  host: string | null
  hosts: Map<string, string>
  primaryOrigin: string
  returnTo: string
}

async function readRequest(request: Request): Promise<HandoffRequest> {
  const url = new URL(request.url)
  const origins = await getSectionOrigins()
  return {
    url,
    host: normalizeHost(requestWorkspaceHost(request)),
    hosts: handoffHosts(origins),
    primaryOrigin: origins.primary,
    returnTo: handoffReturnTo(url.searchParams.get('returnTo')),
  }
}

/**
 * Leg 1, on the target host. Already signed in here, or asked to bounce to a
 * host that is not this workspace's: straight to returnTo. Otherwise set the
 * state cookie and send the browser to the source to mint.
 */
export async function beginSectionHandoff(request: Request): Promise<Response> {
  const { url, host, hosts, returnTo } = await readRequest(request)
  const fromHost = normalizeHost(url.searchParams.get('from'))
  const fromOrigin = fromHost ? hosts.get(fromHost) : undefined
  if (!host || !hosts.has(host) || !fromOrigin || fromHost === host) {
    log.info({ reason: 'not_a_workspace_host' }, 'section handoff not started')
    return redirect(returnTo)
  }
  if (await hasSession(request.headers)) return redirect(returnTo)

  const state = randomToken()
  const secure = isSecureOrigin(hosts.get(host))
  const params = new URLSearchParams({ to: host, state: sha256(state), returnTo })
  return redirect(`${fromOrigin}${SECTION_HANDOFF_MINT_PATH}?${params.toString()}`, [
    stateCookie(state, secure, STATE_TTL_SECONDS),
  ])
}

/**
 * Leg 2, on the source host. Mints only for a signed-in session and only for
 * another host of this workspace; the token goes nowhere but that host.
 */
export async function mintSectionHandoff(request: Request): Promise<Response> {
  const { url, host, hosts, returnTo } = await readRequest(request)
  const toHost = normalizeHost(url.searchParams.get('to'))
  const toOrigin = toHost ? hosts.get(toHost) : undefined
  if (!host || !hosts.has(host) || !toHost || !toOrigin || toHost === host) {
    log.info({ reason: 'not_a_workspace_host' }, 'section handoff not minted')
    return redirect('/')
  }
  const signedOut = `${toOrigin}${returnTo}`
  const stateHash = url.searchParams.get('state') ?? ''
  if (!SHA256_HEX.test(stateHash)) {
    log.info({ reason: 'bad_state' }, 'section handoff not minted')
    return redirect(signedOut)
  }
  const session = await hasSession(request.headers)
  if (!session) return redirect(signedOut)

  const token = randomToken()
  const stored: StoredHandoff = { s: session.token, h: toHost, b: stateHash }
  try {
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `${TOKEN_IDENTIFIER_PREFIX}${sha256(token)}`,
      value: JSON.stringify(stored),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    })
  } catch (err) {
    log.error(errorKind(err), 'section handoff not minted: the token was not stored')
    return redirect(signedOut)
  }
  await sweepExpiredTokens()
  const params = new URLSearchParams({ token, returnTo })
  return redirect(`${toOrigin}${SECTION_HANDOFF_FINISH_PATH}?${params.toString()}`)
}

/**
 * Tokens never finished (a closed tab, a lost network) are left behind. Each
 * mint clears the expired ones, so they never pile up. Best effort.
 */
async function sweepExpiredTokens(): Promise<void> {
  try {
    await db
      .delete(verification)
      .where(
        and(
          like(verification.identifier, `${TOKEN_IDENTIFIER_PREFIX}%`),
          lt(verification.expiresAt, new Date())
        )
      )
  } catch (err) {
    log.warn(errorKind(err), 'expired section handoff tokens not cleared')
  }
}

/** Delete the token's row and hand back what it held: one finish per token, whatever happens next. */
async function spendToken(token: string): Promise<StoredHandoff | null> {
  const [row] = await db
    .delete(verification)
    .where(eq(verification.identifier, `${TOKEN_IDENTIFIER_PREFIX}${sha256(token)}`))
    .returning({ value: verification.value, expiresAt: verification.expiresAt })
  if (!row || row.expiresAt.getTime() <= Date.now()) return null
  try {
    const parsed = JSON.parse(row.value) as Partial<StoredHandoff>
    if (
      typeof parsed.s === 'string' &&
      typeof parsed.h === 'string' &&
      typeof parsed.b === 'string'
    ) {
      return { s: parsed.s, h: parsed.h, b: parsed.b }
    }
  } catch {
    // An unreadable row is no token.
  }
  return null
}

/**
 * Install the carried session through the auth library's own verify, so the
 * cookie is exactly a normal sign-in's. The verify is asked as the primary
 * origin, which the library always trusts; the cookie it sets carries no
 * Domain, so the browser keeps it for this host only.
 */
async function installSession(
  sessionToken: string,
  returnTo: string,
  primaryOrigin: string
): Promise<string[] | null> {
  const inner = randomToken()
  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier: `one-time-token:${inner}`,
    value: sessionToken,
    expiresAt: new Date(Date.now() + INNER_TTL_MS),
  })
  const primary = new URL(primaryOrigin)
  const { verifyOttCookies } = await import('@/lib/server/functions/origin-transfer')
  const result = await verifyOttCookies(
    inner,
    returnTo,
    new Headers({ host: primary.host, 'x-forwarded-proto': primary.protocol.replace(':', '') })
  )
  if (result.kind === 'redirect' && result.cookies.length > 0) return result.cookies
  // A refused verify may have left the inner row; it must not outlive this request.
  await db
    .delete(verification)
    .where(eq(verification.identifier, `one-time-token:${inner}`))
    .catch(() => undefined)
  return null
}

/**
 * Leg 3, on the target host. The token is spent first, then checked against
 * this host and the state cookie. Any failure lands on returnTo signed out.
 */
export async function finishSectionHandoff(request: Request): Promise<Response> {
  const { url, host, hosts, primaryOrigin, returnTo } = await readRequest(request)
  const secure = isSecureOrigin(host ? hosts.get(host) : undefined)
  const clearState = stateCookie('', secure, 0)
  const signedOut = (reason: string) => {
    log.info({ reason }, 'section handoff refused')
    return redirect(returnTo, [clearState])
  }

  const token = url.searchParams.get('token')
  if (!token || !host || !hosts.has(host)) return signedOut('not_a_workspace_host')

  const stored = await spendToken(token).catch((err: unknown) => {
    log.error(errorKind(err), 'section handoff token lookup failed')
    return null
  })
  if (!stored) return signedOut('unknown_or_expired')
  if (stored.h !== host) return signedOut('wrong_host')

  const state = readCookie(request, stateCookieName(secure))
  if (!state || !sameHash(sha256(state), stored.b)) return signedOut('state_mismatch')

  const cookies = await installSession(stored.s, returnTo, primaryOrigin).catch((err: unknown) => {
    log.error(errorKind(err), 'section handoff session install failed')
    return null
  })
  if (!cookies) return signedOut('session_not_installed')

  log.info({ outcome: 'installed' }, 'section handoff finished')
  return redirect(returnTo, [...cookies, clearState])
}
