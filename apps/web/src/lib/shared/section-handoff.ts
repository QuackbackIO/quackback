/**
 * Signing in across section hosts. Sessions are host-only cookies, so a
 * viewer signed in on acme.com is signed out on help.acme.com. A one-time
 * handoff carries the session across; there is never a parent-domain cookie.
 *
 * The flow, all GETs and all 302s (lib/server/auth/section-handoff.ts):
 *
 *   1. Target host, SECTION_HANDOFF_PATH?from=<source host>&returnTo=<path>
 *      Already signed in here: straight to returnTo. Otherwise a random state
 *      goes into a host-only cookie and the browser is sent to the source.
 *   2. Source host, SECTION_HANDOFF_PATH?leg=mint&to=<target>&state=<hash>&returnTo
 *      Signed in: a single-use token bound to the target host and the state is
 *      minted, and the browser goes back to the target with it. Signed out: to
 *      returnTo on the target, signed out.
 *   3. Target host, SECTION_HANDOFF_PATH?leg=finish&token=<token>&returnTo=<path>
 *      The token is burned, then checked against this host and the state
 *      cookie; on a match the session cookie is installed. Either way the
 *      browser lands on returnTo, with the token gone from the address bar.
 *
 * This module is client-safe and pure: the addresses that start a handoff, and
 * which return paths one accepts.
 */
import { isSafeCallbackUrl } from './routing'
import { normalizeHost } from './section-domains'
import type { SectionOrigins } from './section-links'

export const SECTION_HANDOFF_PATH = '/auth/section-handoff'
/** Provider sign-in started from a section host runs on the primary domain. */
export const SECTION_SIGN_IN_PATH = '/auth/section-sign-in'

const MAX_RETURN_TO_LENGTH = 2048

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * A same-origin relative path a handoff may land on, or null. On top of the
 * usual callback rules, every percent-decoded form must still be a plain
 * path: a server or browser that decodes once more must not find `//`, a
 * backslash or a control character at the front. The handoff's own paths are
 * refused so a handoff can never loop into another.
 */
export function safeHandoffReturnTo(value: unknown): string | null {
  if (!isSafeCallbackUrl(value) || value.length > MAX_RETURN_TO_LENGTH) return null
  let stage: string = value
  for (let round = 0; round < 4; round += 1) {
    let decoded: string
    try {
      decoded = decodeURIComponent(stage)
    } catch {
      return null
    }
    if (decoded === stage) break
    if (decoded.startsWith('//') || decoded.includes('\\') || hasControlChar(decoded)) {
      return null
    }
    stage = decoded
  }
  if (stage.startsWith('/auth/section-')) return null
  return value
}

/** A return path a handoff accepts, else the home page. */
export function handoffReturnTo(value: unknown): string {
  return safeHandoffReturnTo(value) ?? '/'
}

const SESSION_COOKIE = /(?:^|;)\s*(?:__Secure-)?better-auth\.session_token=/

/**
 * Whether a Cookie header carries a session cookie. Only a hint, for choosing
 * the handoff over a plain move: a stale cookie costs one extra redirect, and
 * the mint leg checks the session for real.
 */
export function carriesSessionCookie(cookieHeader: string | null | undefined): boolean {
  return SESSION_COOKIE.test(cookieHeader ?? '')
}

/**
 * Where a move to another host of this workspace sends a visitor who may be
 * signed in: through the handoff on the target, or null when the move stays on
 * this host or cannot be read.
 */
export function handoffForMove(location: string, hereHost: string): string | null {
  let target: URL
  try {
    target = new URL(location)
  } catch {
    return null
  }
  if (normalizeHost(target.host) === normalizeHost(hereHost)) return null
  return sectionHandoffUrl({
    targetOrigin: target.origin,
    fromHost: hereHost,
    returnTo: `${target.pathname}${target.search}`,
  })
}

/** The address that carries a signed-in viewer from `fromHost` to `targetOrigin`. */
export function sectionHandoffUrl({
  targetOrigin,
  fromHost,
  returnTo,
}: {
  targetOrigin: string
  fromHost: string
  returnTo: string
}): string {
  const params = new URLSearchParams({ from: fromHost, returnTo: handoffReturnTo(returnTo) })
  return `${targetOrigin.replace(/\/+$/, '')}${SECTION_HANDOFF_PATH}?${params.toString()}`
}

/**
 * A link to `href` on another host of this workspace, from a page on
 * `links.hostOrigin`. A signed-in viewer goes through the handoff so they
 * arrive signed in; a signed-out viewer gets the plain link.
 */
export function crossHostHref(
  href: string,
  { links, signedIn }: { links: { origins: SectionOrigins; hostOrigin: string }; signedIn: boolean }
): string {
  if (!signedIn) return href
  let target: URL
  let here: URL
  try {
    target = new URL(href)
    here = new URL(links.hostOrigin)
  } catch {
    return href
  }
  if (target.origin === here.origin) return href
  return sectionHandoffUrl({
    targetOrigin: target.origin,
    fromHost: normalizeHost(here.host) ?? here.hostname,
    returnTo: `${target.pathname}${target.search}${target.hash}`,
  })
}

/**
 * Where provider sign-in (OAuth, OIDC) starts when the page is on a section
 * host. The provider's callback lives on the primary domain, and so does its
 * state cookie, so the sign-in runs there and the handoff brings the session
 * back to `hereHost`.
 */
export function sectionSignInUrl({
  primaryOrigin,
  hereHost,
  provider,
  returnTo,
  errorReturnTo,
  loginHint,
}: {
  primaryOrigin: string
  hereHost: string
  provider: string
  returnTo: string
  errorReturnTo: string
  loginHint?: string
}): string {
  const params = new URLSearchParams({
    provider,
    to: hereHost,
    returnTo: handoffReturnTo(returnTo),
    errorReturnTo: handoffReturnTo(errorReturnTo),
    ...(loginHint ? { loginHint } : {}),
  })
  return `${primaryOrigin.replace(/\/+$/, '')}${SECTION_SIGN_IN_PATH}?${params.toString()}`
}
