/**
 * P01 — alpha's session cookie presented to bravo's hostname.
 *
 * Under pooled compute the session cookie is signed with the process's
 * `SECRET_KEY` and looked up in `session` by its raw token. If tenant resolution
 * returns the wrong pool, the lookup runs against the wrong database. It will
 * usually miss — but `auth/index.ts:78` also memoises a whole better-auth
 * instance behind a small monotonic per-tenant integer (`_authConfigVersion`),
 * and two tenants' counters can coincide, at which point the wrong instance
 * verifies the session. That is the failure this probe hunts.
 *
 * Three presentation paths are exercised, because they are three different code
 * paths: the cookie jar, the raw token as a Bearer credential (the `bearer()`
 * plugin is enabled), and an authenticated SSR document.
 */

import {
  control,
  describeResponse,
  error,
  leak,
  markersPresent,
  pass,
  requirePositiveControl,
} from './helpers'
import type { Probe, ProbeContext, TenantHandle } from '../types'

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
    'Today alpha and bravo are separate processes with separate SECRET_KEYs and separate session ' +
    'tables, so a refusal is over-determined. Under pooling the same process holds one better-auth ' +
    'instance cache and one signing key, which is when this probe becomes load-bearing.',

  async run(ctx: ProbeContext) {
    const { alpha, bravo } = ctx
    const attempted =
      "sign in as the workspace admin on alpha, then replay alpha's session cookie, its raw " +
      "session token as a Bearer credential, and an authenticated document request against bravo's hostname"

    const alphaCookie = alpha.adminCookies
    if (!alphaCookie) {
      return error({
        attempted,
        observed: 'alpha has no admin session cookie',
        reason: 'preflight did not establish an admin session on alpha',
      })
    }

    // --- positive control: the cookie authenticates on its own tenant --------
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
    const bail = requirePositiveControl(positive, attempted)
    if (bail) return bail

    const controls = [positive]
    const evidence: Record<string, unknown> = { alphaUserId: ownUser }

    // --- negative 1: the cookie on bravo ------------------------------------
    const foreign = ctx.newClient(bravo)
    foreign.setCookieHeader(alphaCookie)
    const cookieRes = await foreign.request('/api/auth/get-session', {
      expectsForeignMarkers: true,
    })
    const cookieUser = cookieRes.json<SessionBody>()?.user?.id ?? null
    controls.push(
      control(
        'negative',
        'alpha cookie → bravo /api/auth/get-session',
        cookieUser === null,
        cookieUser === null
          ? `refused: ${describeResponse(cookieRes, 120)}`
          : `AUTHENTICATED as user ${cookieUser}`
      )
    )
    evidence.bravoCookieResponse = describeResponse(cookieRes, 400)

    // --- negative 2: the raw token as a Bearer credential -------------------
    const raw = rawSessionToken(alphaCookie)
    let bearerUser: string | null = null
    if (raw) {
      const bearerClient = ctx.newClient(bravo)
      const bearerRes = await bearerClient.request('/api/auth/get-session', {
        headers: { authorization: `Bearer ${raw}` },
        expectsForeignMarkers: true,
      })
      bearerUser = bearerRes.json<SessionBody>()?.user?.id ?? null
      controls.push(
        control(
          'negative',
          "alpha's raw session token → bravo /api/auth/get-session as Bearer",
          bearerUser === null,
          bearerUser === null
            ? `refused: ${describeResponse(bearerRes, 120)}`
            : `AUTHENTICATED as user ${bearerUser}`
        )
      )
      evidence.bravoBearerResponse = describeResponse(bearerRes, 400)
    } else {
      controls.push(
        control(
          'negative',
          "alpha's raw session token → bravo as Bearer",
          false,
          'could not extract a raw session token from the cookie jar'
        )
      )
    }

    // --- negative 3: an authenticated document ------------------------------
    const docClient = ctx.newClient(bravo)
    docClient.setCookieHeader(alphaCookie)
    const docRes = await docClient.request('/admin', { expectsForeignMarkers: true })
    const alphaMarkersInDoc = markersPresent(docRes.text, alpha.markers)
    controls.push(
      control(
        'negative',
        'alpha cookie → bravo GET /admin',
        alphaMarkersInDoc.length === 0,
        alphaMarkersInDoc.length === 0
          ? `HTTP ${docRes.status}, no alpha markers in the document`
          : `HTTP ${docRes.status}, ALPHA MARKERS PRESENT: ${alphaMarkersInDoc.join(', ')}`
      )
    )
    evidence.bravoAdminDocMarkers = alphaMarkersInDoc

    const failures = controls.filter((c) => c.kind === 'negative' && !c.ok)
    if (failures.length > 0) {
      const identityNote =
        cookieUser && cookieUser === ownUser
          ? " and the identity returned is alpha's own user id, so bravo served alpha's database"
          : cookieUser
            ? ` and the identity returned (${cookieUser}) belongs to bravo, so a credential minted by alpha authenticated a different tenant's account — the colliding admin address made it look correct`
            : ''
      return leak({
        attempted,
        observed: failures.map((f) => `${f.label}: ${f.detail}`).join(' | '),
        reason: `a credential issued by alpha was honoured by bravo${identityNote}`,
        controls,
        evidence,
      })
    }

    return pass({
      attempted,
      observed:
        `bravo refused all three presentations (cookie: ${describeResponse(cookieRes, 80)}; ` +
        `bearer: ${bearerUser === null ? 'no session' : bearerUser}; document: no alpha markers)`,
      reason: 'alpha-issued session credentials authenticate on alpha and nowhere else',
      controls,
      evidence,
    })
  },
}

/** Exported for the runner's handle typing. */
export type { TenantHandle }
