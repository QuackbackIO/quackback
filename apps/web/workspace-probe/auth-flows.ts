/**
 * Magic-link and sign-in-OTP primitives.
 *
 * Both credentials leave the server by email, so the only way to observe them
 * is to read the `verification` row the server just wrote — the same approach
 * the e2e helpers take (`apps/web/e2e/scripts/get-magic-link-token.ts`,
 * `get-otp-code.ts`). That is why the P02 family requires database access: the
 * probe has to redeem a REAL token minted by alpha, not a synthetic one, or it
 * would only be testing that bravo rejects garbage.
 */

import { MAGIC_LINK_TOKEN_SQL, OTP_CODE_SQL, magicLinkEmailPattern, otpIdentifier } from './db'
import type { WorkspaceDb, WorkspaceHandle, WorkspaceHttp } from './types'

export interface MintedCredential {
  token?: string
  detail: string
  /** Status of the send request. */
  sendStatus: number
}

/** Ask a workspace to mint a magic link, then read the token out of its database. */
export async function mintAndReadMagicLinkOn(
  http: WorkspaceHttp,
  db: WorkspaceDb,
  email: string
): Promise<MintedCredential> {
  const send = await http.request('/api/auth/sign-in/magic-link', {
    method: 'POST',
    omitCookies: true,
    body: JSON.stringify({ email, callbackURL: '/' }),
  })
  if (send.status >= 400) {
    return {
      sendStatus: send.status,
      detail: `POST /api/auth/sign-in/magic-link returned ${send.status}: ${send.text.slice(0, 200)}`,
    }
  }
  const rows = await db.query<{ identifier: string }>(MAGIC_LINK_TOKEN_SQL, [
    magicLinkEmailPattern(email),
  ])
  const token = rows[0]?.identifier
  return {
    sendStatus: send.status,
    token,
    detail: token
      ? `minted a live magic-link token on ${http.slot}`
      : `no live magic-link verification row found on ${http.slot} for ${email}`,
  }
}

export async function mintAndReadMagicLink(
  handle: WorkspaceHandle,
  email: string
): Promise<MintedCredential> {
  if (!handle.db) return { sendStatus: 0, detail: 'no database connection for this workspace' }
  return mintAndReadMagicLinkOn(handle.http, handle.db, email)
}

export interface RedemptionResult {
  sessionEstablished: boolean
  status: number
  detail: string
  /** The user id the resulting session belongs to, when one was created. */
  userId?: string
  /** Raw response body of the verify call. */
  body: string
  location?: string
}

/**
 * Redeem a magic-link token against a host.
 *
 * Redirects are deliberately not followed: better-auth answers a successful
 * verify with a 302 to the callback URL and a `Set-Cookie`, and a failed one
 * with a 302 to the error URL and no cookie. Following the redirect would
 * discard the distinction and send the credential onward.
 */
export async function redeemMagicLinkOn(
  http: WorkspaceHttp,
  token: string,
  opts: { expectsForeignMarkers?: boolean } = {}
): Promise<RedemptionResult> {
  http.clearCookies()
  const res = await http.request(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=/`,
    { omitCookies: true, expectsForeignMarkers: opts.expectsForeignMarkers }
  )
  const location = res.headers.location
  const sessionCookiePresent = http
    .cookieHeader()
    .split(';')
    .some((c) => c.trim().split('=')[0].endsWith('better-auth.session_token'))

  if (!sessionCookiePresent) {
    return {
      sessionEstablished: false,
      status: res.status,
      detail: `no session cookie issued (status ${res.status}${location ? `, location ${location}` : ''})`,
      body: res.text,
      location,
    }
  }

  const session = await http.request('/api/auth/get-session', {
    expectsForeignMarkers: opts.expectsForeignMarkers,
  })
  const userId = session.json<{ user?: { id?: string } }>()?.user?.id
  return {
    sessionEstablished: Boolean(userId),
    status: res.status,
    detail: userId
      ? `session established for user ${userId}`
      : `session cookie issued but get-session returned no user (status ${session.status})`,
    userId,
    body: session.text,
    location,
  }
}

export async function redeemMagicLink(
  handle: WorkspaceHandle,
  token: string
): Promise<RedemptionResult> {
  return redeemMagicLinkOn(handle.http, token)
}

/** Ask a workspace to mint a sign-in OTP, then read the code out of its database. */
export async function mintAndReadOtpOn(
  http: WorkspaceHttp,
  db: WorkspaceDb,
  email: string
): Promise<MintedCredential> {
  const send = await http.request('/api/auth/email-otp/send-verification-otp', {
    method: 'POST',
    omitCookies: true,
    body: JSON.stringify({ email, type: 'sign-in' }),
  })
  if (send.status >= 400) {
    return {
      sendStatus: send.status,
      detail: `POST /api/auth/email-otp/send-verification-otp returned ${send.status}: ${send.text.slice(0, 200)}`,
    }
  }
  const rows = await db.query<{ value: string }>(OTP_CODE_SQL, [otpIdentifier(email)])
  // Stored as '<code>:<attempts>'.
  const token = rows[0]?.value?.split(':')[0]
  return {
    sendStatus: send.status,
    token,
    detail: token
      ? `minted a live sign-in OTP on ${http.slot}`
      : `no live sign-in OTP verification row found on ${http.slot} for ${email}`,
  }
}

/** Verify a sign-in OTP against a host. */
export async function verifyOtpOn(
  http: WorkspaceHttp,
  email: string,
  otp: string,
  opts: { expectsForeignMarkers?: boolean } = {}
): Promise<RedemptionResult> {
  http.clearCookies()
  const res = await http.request('/api/auth/sign-in/email-otp', {
    method: 'POST',
    omitCookies: true,
    body: JSON.stringify({ email, otp }),
    expectsForeignMarkers: opts.expectsForeignMarkers,
  })
  const sessionCookiePresent = http
    .cookieHeader()
    .split(';')
    .some((c) => c.trim().split('=')[0].endsWith('better-auth.session_token'))

  if (!sessionCookiePresent) {
    return {
      sessionEstablished: false,
      status: res.status,
      detail: `no session cookie issued (status ${res.status})`,
      body: res.text,
    }
  }
  const session = await http.request('/api/auth/get-session', {
    expectsForeignMarkers: opts.expectsForeignMarkers,
  })
  const userId = session.json<{ user?: { id?: string } }>()?.user?.id
  return {
    sessionEstablished: Boolean(userId),
    status: res.status,
    detail: userId ? `session established for user ${userId}` : 'session cookie issued but no user',
    userId,
    body: session.text,
  }
}
