/**
 * P01 — alpha's session cookie presented to bravo's hostname.
 *
 * Under pooled compute the session cookie is signed with the process's
 * `SECRET_KEY` and looked up in `session` by its raw token. If workspace resolution
 * returns the wrong pool, the lookup runs against the wrong database. It will
 * usually miss — but `auth/index.ts:78` also memoises a whole better-auth
 * instance behind a small monotonic per-workspace integer (`_authConfigVersion`),
 * and two workspaces' counters can coincide, at which point the wrong instance
 * verifies the session. That is the failure this probe hunts.
 *
 * Three presentation paths are exercised, because they are three different code
 * paths: the cookie jar, the raw token as a Bearer credential (the `bearer()`
 * plugin is enabled), and an authenticated SSR document.
 */

import {
  control,
  crossOriginRedirectControl,
  decide,
  dirFrom,
  describeResponse,
  halt,
  markersPresent,
} from './helpers'
import type { ControlOutcome, Probe, ProbeContext, ProbeResponse, WorkspaceHandle } from '../types'

interface SessionBody {
  session?: { id?: string; userId?: string } | null
  user?: { id?: string; email?: string } | null
}

/** better-auth issues `<rawToken>.<hmac>`; the `session` row stores the raw part. */
function rawSessionToken(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (!name.endsWith('better-auth.session_token')) continue
    const value = decodeURIComponent(rest.join('='))
    return value.split('.')[0]
  }
  return undefined
}

export const p01SessionCookie: Probe = {
  id: 'P01',
  name: 'session-cookie-cross-host',
  family: 'session',
  proves:
    "A session minted by alpha authenticates nothing on bravo's hostname, by cookie, by Bearer token, " +
    'or on an authenticated SSR document — and bravo never answers with alpha’s identity.',
  requires: ['http', 'admin'],
  poolingCaveat:
    'This fleet already serves both workspaces from ONE process: one service, one replica, one region, ' +
    'one SECRET_KEY and one better-auth instance cache — and both workspaces currently sit on ' +
    'auth_config_version 3, the coinciding-counter case this probe hunts, while sharing an admin ' +
    'address. A refusal here is therefore NOT over-determined by topology, and this probe is ' +
    'load-bearing today rather than at some later date. What remains genuinely undetermined is ' +
    'narrower: `session` rows live in per-workspace databases, so a lookup routed to the WRONG pool ' +
    'finds no row and refuses in exactly the way a correctly routed lookup refuses an unknown ' +
    'token. A pass says no session crossed the boundary; it does not say workspace resolution was ' +
    'correct, and database-per-workspace alone would explain the same silence.',

  async run(ctx: ProbeContext) {
    const { alpha, bravo } = ctx
    const attempted =
      "sign in as the workspace admin on alpha, then replay alpha's session cookie, its raw " +
      "session token as a Bearer credential, and an authenticated document request against bravo's hostname"

    const leakReason0 = 'a credential issued by one workspace was honoured by the other'
    const alphaCookie = alpha.adminCookies
    if (!alphaCookie) {
      return halt({
        attempted,
        controls: [],
        stopped: {
          label: 'alpha holds an admin session cookie to replay',
          detail: 'alpha has no admin session cookie',
        },
        reason: 'preflight did not establish an admin session on alpha',
        leakReason: leakReason0,
      })
    }

    // --- positive control: the cookie authenticates on its own workspace --------
    const own = ctx.newClient(alpha)
    own.setCookieHeader(alphaCookie)
    const ownRes = await own.request('/api/auth/get-session')
    const ownUser = ownRes.json<SessionBody>()?.user?.id
    const positive = control(
      'positive',
      'alpha cookie → alpha /api/auth/get-session',
      Boolean(ownUser),
      ownUser
        ? `authenticated as user ${ownUser}`
        : `no user returned (${describeResponse(ownRes)}) — the replayed cookie does not even work at home`
    )
    if (!positive.ok) {
      return halt({
        attempted,
        controls: [],
        stopped: { label: positive.label, detail: positive.detail },
        reason:
          'the positive control failed, so a refusal from the other workspace proves nothing — the ' +
          'credential under test does not work even within its own workspace. Fix this before reading ' +
          'any verdict from this probe.',
        leakReason: leakReason0,
      })
    }

    const controls: ControlOutcome[] = [positive]
    const evidence: Record<string, unknown> = { alphaUserId: ownUser }

    // --- negatives, in BOTH directions --------------------------------------
    //
    // Direction matters whenever the thing under test is a keyed store: a
    // shared session table or a shared better-auth instance cache resolves
    // whichever entry survives, and testing one direction leaves detection to
    // chance. The same asymmetry hid a shared OTP stash from P02 entirely.
    const bravoCookie = bravo.adminCookies
    // Retained for the identity note below: whose account bravo answered with
    // when it accepted alpha's cookie is the difference between "served alpha's
    // database" and "authenticated alpha against bravo's account".
    let cookieUser: string | null = null
    /** The admin-shell reads, for the joint cross-origin-redirect adjudication. */
    const adminReads: Array<{ slot: string; res: ProbeResponse; otherBaseUrl: string }> = []

    for (const [fromSlot, toSlot, from, to, cookie] of [
      ['alpha', 'bravo', alpha, bravo, alphaCookie],
      ['bravo', 'alpha', bravo, alpha, bravoCookie],
    ] as const) {
      if (!cookie) {
        controls.push(
          control(
            'negative',
            `${fromSlot} cookie → ${toSlot}`,
            false,
            `no admin session on ${fromSlot}`,
            dirFrom(fromSlot),
            'session-cookie-replay'
          )
        )
        continue
      }

      const foreign = ctx.newClient(to)
      foreign.setCookieHeader(cookie)
      const cookieRes = await foreign.request('/api/auth/get-session', {
        expectsForeignMarkers: true,
      })
      const seenUser = cookieRes.json<SessionBody>()?.user?.id ?? null
      if (fromSlot === 'alpha') cookieUser = seenUser
      controls.push(
        control(
          'negative',
          `${fromSlot} cookie → ${toSlot} /api/auth/get-session`,
          seenUser === null,
          seenUser === null
            ? `refused: ${describeResponse(cookieRes, 120)}`
            : `AUTHENTICATED as user ${seenUser}`,
          dirFrom(fromSlot),
          'session-cookie-replay'
        )
      )
      evidence[`${toSlot}CookieResponse`] = describeResponse(cookieRes, 400)

      const raw = rawSessionToken(cookie)
      if (raw) {
        const bearerClient = ctx.newClient(to)
        const bearerRes = await bearerClient.request('/api/auth/get-session', {
          headers: { authorization: `Bearer ${raw}` },
          expectsForeignMarkers: true,
        })
        const seenBearer = bearerRes.json<SessionBody>()?.user?.id ?? null
        controls.push(
          control(
            'negative',
            `${fromSlot}'s raw session token → ${toSlot} as Bearer`,
            seenBearer === null,
            seenBearer === null
              ? `refused: ${describeResponse(bearerRes, 120)}`
              : `AUTHENTICATED as user ${seenBearer}`,
            dirFrom(fromSlot),
            'session-raw-bearer'
          )
        )
      } else {
        controls.push(
          control(
            'negative',
            `${fromSlot}'s raw session token → ${toSlot} as Bearer`,
            false,
            'could not extract a raw session token from the cookie jar',
            dirFrom(fromSlot),
            'session-raw-bearer'
          )
        )
      }

      const docClient = ctx.newClient(to)
      docClient.setCookieHeader(cookie)
      // `followRedirects` because on this app the admin shell answers an
      // unauthenticated (or wrong-workspace) request with `307 → /?auth=signin…`
      // and a ZERO-BYTE body. Judging the unfollowed response scanned an empty
      // string for foreign markers and found none, every single time.
      const docRes = await docClient.request('/admin', {
        expectsForeignMarkers: true,
        followRedirects: true,
      })
      adminReads.push({ slot: to.slot, res: docRes, otherBaseUrl: from.baseUrl })
      const foreignMarkers = markersPresent(
        docRes.text,
        fromSlot === 'alpha' ? alpha.markers : bravo.markers
      )
      controls.push(
        control(
          'negative',
          `${fromSlot} cookie → ${toSlot} GET /admin`,
          foreignMarkers.length === 0,
          foreignMarkers.length === 0
            ? `HTTP ${docRes.status}, no ${fromSlot} markers in the document`
            : `HTTP ${docRes.status}, ${fromSlot.toUpperCase()} MARKERS PRESENT: ${foreignMarkers.join(', ')}`,
          dirFrom(fromSlot),
          'session-ssr-document'
        )
      )
      evidence[`${toSlot}AdminDocMarkers`] = foreignMarkers
    }

    const redirectControl = crossOriginRedirectControl('GET /admin', adminReads)
    if (redirectControl) controls.push(redirectControl)

    const identityNote =
      cookieUser && cookieUser === ownUser
        ? " and the identity returned is alpha's own user id, so bravo served alpha's database"
        : cookieUser
          ? ` and the identity returned (${cookieUser}) belongs to bravo, so a credential minted by alpha authenticated a different workspace's account — the colliding admin address made it look correct`
          : ''

    return decide({
      attempted,
      controls,
      leakReason: `a credential issued by alpha was honoured by bravo${identityNote}`,
      onPass: {
        observed:
          'each host refused the other\u2019s session cookie, its raw token as a Bearer credential, and an ' +
          'authenticated document request \u2014 in both directions',
        reason: 'alpha-issued session credentials authenticate on alpha and nowhere else',
      },
      evidence,
    })
  },
}

/** Exported for the runner's handle typing. */
export type { WorkspaceHandle }
