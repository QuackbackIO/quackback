// @vitest-environment node
/**
 * Signing in across section hosts, against real Postgres and the PRODUCTION
 * auth instance (`getAuth()`: the real hooks, cookie settings and trusted
 * origins). The workspace serves acme.com (primary), help.acme.com and
 * status.acme.com. Each test drives the three steps as the browser would:
 * begin on the target, mint on the source, finish on the target.
 *
 * Only the section table, the request headers and the logger are stood in
 * for. A double that answers "valid" or "invalid" cannot tell a replay from an
 * expiry from a token for another host, so the rows are real rows and every
 * cookie comes from the auth library itself.
 *
 * Every write rolls back with the fixture transaction. Like every *.db.test.ts
 * it is skipped when no Postgres is reachable.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  like,
  oauthResource,
  principal,
  session,
  settings,
  user,
  verification,
} from '@/lib/server/db'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.hoisted(() => {
  process.env.BASE_URL = 'https://acme.com'
  process.env.SECRET_KEY = 'test-secret-key-for-section-handoff-0123456789'
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const hoisted = vi.hoisted(() => {
  const logCalls: unknown[][] = []
  const log: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'child') return () => log
        if (prop === 'level') return 'info'
        if (prop === 'isLevelEnabled') return () => true
        if (prop === 'then') return undefined
        return (...args: unknown[]) => {
          logCalls.push(args)
        }
      },
    }
  )
  return {
    logCalls,
    log,
    /** When set, the session lookup fails with this error. */
    failSession: null as Error | null,
    requestHeaders: new Headers(),
    origins: {
      primary: 'https://acme.com',
      feedback: 'https://acme.com',
      roadmap: 'https://acme.com',
      changelog: 'https://acme.com',
      help: 'https://help.acme.com',
      support: 'https://acme.com',
      status: 'https://status.acme.com',
    } as Record<string, string>,
  }
})

vi.mock('@/lib/server/logger', () => ({ logger: hoisted.log }))
vi.mock('@/lib/server/domains/settings/section-links', () => ({
  getSignInSectionOrigins: async () => hoisted.origins,
  getSectionOrigins: async () => hoisted.origins,
}))
// The real auth instance, with one fault switch on its session lookup.
vi.mock('@/lib/server/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/auth')>()
  return {
    ...real,
    auth: {
      handler: (request: Request) => real.auth.handler(request),
      get api() {
        return new Proxy(real.auth.api, {
          get: (target, prop) =>
            prop === 'getSession' && hoisted.failSession
              ? async () => {
                  throw hoisted.failSession
                }
              : (target as Record<string | symbol, unknown>)[prop],
        })
      },
    },
  }
})
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => hoisted.requestHeaders,
}))
// Server functions run their own validator, as the server does.
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | null = null
    const chain: Record<string, unknown> = {}
    chain.validator = (next: { parse: (value: unknown) => unknown }) => {
      schema = next
      return chain
    }
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign(
        async (args?: { data?: unknown }) =>
          handler({ data: schema ? schema.parse(args?.data) : args?.data }),
        chain
      )
    return chain
  },
}))

const { beginSectionHandoff, mintSectionHandoff, finishSectionHandoff, SECTION_STATE_COOKIE } =
  await import('../section-handoff')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: session.id, scope: session.scope }).from(session).limit(0)
    await db.select({ identifier: verification.identifier }).from(verification).limit(0)
  },
})

const PRIMARY = 'acme.com'
const HELP = 'help.acme.com'
const STATUS = 'status.acme.com'

function get(host: string, pathAndQuery: string, cookie?: string): Request {
  return new Request(`https://${host}${pathAndQuery}`, {
    headers: { host, ...(cookie ? { cookie } : {}) },
  })
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie()
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0]!
}

function location(response: Response): URL {
  const raw = response.headers.get('location')
  expect(raw).toBeTruthy()
  return new URL(raw!, 'https://relative.invalid')
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

async function handoffRows(): Promise<number> {
  const rows = await testDb
    .select({ id: verification.id })
    .from(verification)
    .where(like(verification.identifier, 'section-handoff:%'))
  return rows.length
}

describe.skipIf(!fixture.available)('section handoff', () => {
  /** The owner's real dashboard session on the primary domain. */
  let sourceCookie: string
  let sourceToken: string
  let ownerId: UserId

  async function getAuth() {
    const { getAuth } = await import('@/lib/server/auth/index')
    return getAuth()
  }

  /** The session a cookie stands for, read by the production instance. */
  async function sessionOf(cookie: string) {
    const auth = await getAuth()
    return (await auth.api.getSession({ headers: new Headers({ cookie }) })) as {
      user: { id: string }
      session: { id: string; token: string; scope?: string }
    } | null
  }

  beforeEach(async () => {
    await fixture.begin()
    hoisted.logCalls.length = 0
    hoisted.failSession = null
    hoisted.requestHeaders = new Headers()
    await ensureMcpOauthResource({
      db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
      table: oauthResource,
      identifier: 'https://acme.com/api/mcp',
      allowedScopes: API_KEY_SCOPES,
    })
    if ((await testDb.select({ id: settings.id }).from(settings)).length === 0) {
      await testDb.insert(settings).values({
        id: createId('workspace'),
        name: 'Acme',
        slug: `acme-${suffix()}`,
        createdAt: new Date(),
      })
    }

    // The workspace owner, an admin, signed in on the primary domain.
    ownerId = createId('user') as UserId
    await testDb.insert(user).values({
      id: ownerId,
      name: 'Owner',
      email: `owner-${suffix()}@example.com`,
      emailVerified: true,
    })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: ownerId,
      role: 'admin',
      displayName: 'Owner',
      createdAt: new Date(),
    })
    sourceToken = `src${suffix()}${suffix()}`
    await testDb.insert(session).values({
      id: `sess-${suffix()}`,
      token: sourceToken,
      userId: ownerId,
      scope: 'dashboard',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    // Its cookie, as the production instance signs it.
    const ott = `ott${suffix()}`
    await testDb.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `one-time-token:${ott}`,
      value: sourceToken,
      expiresAt: new Date(Date.now() + 60 * 1000),
    })
    const auth = await getAuth()
    const verified = await auth.handler(
      new Request('https://acme.com/api/auth/one-time-token/verify', {
        method: 'POST',
        headers: { origin: 'https://acme.com', 'content-type': 'application/json' },
        body: JSON.stringify({ token: ott }),
      })
    )
    sourceCookie = verified.headers
      .getSetCookie()
      .map(cookiePair)
      .filter((pair) => pair.includes('session_token='))
      .join('; ')
    expect(sourceCookie).toContain('session_token=')
    hoisted.logCalls.length = 0
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  /** Leg 1 on the target: the state cookie and the address of the mint. */
  async function begin(target = HELP, returnTo = '/hc/articles/x?ref=nav') {
    const response = await beginSectionHandoff(
      get(
        target,
        `/auth/section-handoff?${new URLSearchParams({ from: PRIMARY, returnTo }).toString()}`
      )
    )
    const stateSetCookie = setCookies(response).find((c) => c.startsWith(SECTION_STATE_COOKIE))
    return { response, stateCookie: stateSetCookie ? cookiePair(stateSetCookie) : '' }
  }

  /** Legs 1 and 2: the finish address the source sends the browser to. */
  async function beginAndMint(target = HELP, returnTo = '/hc/articles/x?ref=nav') {
    const started = await begin(target, returnTo)
    const mintUrl = location(started.response)
    const minted = await mintSectionHandoff(
      get(PRIMARY, `${mintUrl.pathname}${mintUrl.search}`, sourceCookie)
    )
    return { ...started, minted, finishUrl: location(minted) }
  }

  async function finish(finishUrl: URL, host: string, cookie: string) {
    return finishSectionHandoff(get(host, `${finishUrl.pathname}${finishUrl.search}`, cookie))
  }

  function sessionCookieOf(response: Response): string | undefined {
    return setCookies(response).find((c) => c.includes('session_token=') && !/max-age=0/i.test(c))
  }

  it('carries the session to the target host and lands on returnTo', async () => {
    const { response, stateCookie, minted, finishUrl } = await beginAndMint()

    expect(response.status).toBe(302)
    const mintUrl = location(response)
    expect(mintUrl.origin).toBe('https://acme.com')
    expect(mintUrl.pathname).toBe('/auth/section-handoff')
    expect(mintUrl.searchParams.get('leg')).toBe('mint')
    expect(mintUrl.searchParams.get('to')).toBe(HELP)
    expect(stateCookie).toMatch(new RegExp(`^${SECTION_STATE_COOKIE}=`))

    expect(minted.status).toBe(302)
    expect(finishUrl.origin).toBe('https://help.acme.com')
    expect(finishUrl.pathname).toBe('/auth/section-handoff')
    expect(finishUrl.searchParams.get('leg')).toBe('finish')
    expect(finishUrl.searchParams.get('token')).toBeTruthy()

    const done = await finish(finishUrl, HELP, stateCookie)
    expect(done.status).toBe(302)
    expect(done.headers.get('location')).toBe('/hc/articles/x?ref=nav')
    const installed = sessionCookieOf(done)
    expect(installed).toBeTruthy()
    // The same person, signed in on the target with a session of its own.
    const carried = await sessionOf(cookiePair(installed!))
    expect(carried?.user.id).toBe(ownerId)
    expect(carried?.session.token).not.toBe(sourceToken)
    expect(carried?.session.scope).toBe('portal')
  })

  it('installs a host-only cookie with the attributes of a normal sign-in', async () => {
    const { stateCookie, finishUrl } = await beginAndMint()
    const done = await finish(finishUrl, HELP, stateCookie)
    const installed = sessionCookieOf(done)!
    expect(installed).not.toMatch(/;\s*domain=/i)
    expect(installed).toMatch(/;\s*httponly/i)
    expect(installed).toMatch(/;\s*secure/i)
    expect(installed).toMatch(/;\s*samesite=lax/i)
    expect(installed).toMatch(/;\s*path=\//i)
  })

  it('keeps the state cookie host-only, http-only and short-lived, and clears it at the end', async () => {
    const { response, finishUrl, stateCookie } = await beginAndMint()
    const set = setCookies(response).find((c) => c.startsWith(SECTION_STATE_COOKIE))!
    expect(SECTION_STATE_COOKIE.startsWith('__Host-')).toBe(true)
    expect(set).not.toMatch(/;\s*domain=/i)
    expect(set).toMatch(/;\s*httponly/i)
    expect(set).toMatch(/;\s*secure/i)
    expect(set).toMatch(/;\s*path=\/(;|$)/i)
    expect(set).toMatch(/;\s*max-age=\d{1,3}(;|$)/i)

    const done = await finish(finishUrl, HELP, stateCookie)
    const cleared = setCookies(done).find((c) => c.startsWith(SECTION_STATE_COOKIE))
    expect(cleared).toMatch(/max-age=0/i)
  })

  it('stores only a hash of the token, never the token itself', async () => {
    const { finishUrl } = await beginAndMint()
    const token = finishUrl.searchParams.get('token')!
    const rows = await testDb
      .select({ identifier: verification.identifier, value: verification.value })
      .from(verification)
      .where(like(verification.identifier, 'section-handoff:%'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.identifier).not.toContain(token)
    expect(rows[0]!.value).not.toContain(token)
  })

  describe('single use and short life', () => {
    it('refuses a replay: the second finish lands signed out', async () => {
      const { stateCookie, finishUrl } = await beginAndMint()
      const first = await finish(finishUrl, HELP, stateCookie)
      expect(sessionCookieOf(first)).toBeTruthy()

      const replay = await finish(finishUrl, HELP, stateCookie)
      expect(replay.status).toBe(302)
      expect(replay.headers.get('location')).toBe('/hc/articles/x?ref=nav')
      expect(sessionCookieOf(replay)).toBeUndefined()
    })

    it('refuses an expired token', async () => {
      const { stateCookie, finishUrl } = await beginAndMint()
      await testDb
        .update(verification)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(like(verification.identifier, 'section-handoff:%'))

      const done = await finish(finishUrl, HELP, stateCookie)
      expect(done.headers.get('location')).toBe('/hc/articles/x?ref=nav')
      expect(sessionCookieOf(done)).toBeUndefined()
      expect(await handoffRows()).toBe(0)
    })

    it('mints a token that lives a minute or two at most', async () => {
      await beginAndMint()
      const [row] = await testDb
        .select({ expiresAt: verification.expiresAt })
        .from(verification)
        .where(like(verification.identifier, 'section-handoff:%'))
      expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(2 * 60 * 1000)
    })

    it('clears tokens nobody finished when the next one is minted', async () => {
      await beginAndMint()
      await testDb
        .update(verification)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(like(verification.identifier, 'section-handoff:%'))
      await beginAndMint()
      // Only the fresh token is left.
      expect(await handoffRows()).toBe(1)
    })

    it('refuses when the source session ended before the finish', async () => {
      const { stateCookie, finishUrl } = await beginAndMint()
      await testDb.delete(session)

      const done = await finish(finishUrl, HELP, stateCookie)
      expect(sessionCookieOf(done)).toBeUndefined()
    })
  })

  describe('bound to one host of this workspace', () => {
    it('refuses the token on another section host and burns it', async () => {
      const { stateCookie, finishUrl } = await beginAndMint()
      const wrong = await finish(finishUrl, STATUS, stateCookie)
      expect(sessionCookieOf(wrong)).toBeUndefined()
      expect(await handoffRows()).toBe(0)

      const right = await finish(finishUrl, HELP, stateCookie)
      expect(sessionCookieOf(right)).toBeUndefined()
    })

    it('refuses the token on a host of another workspace', async () => {
      const { stateCookie, finishUrl } = await beginAndMint()
      const done = await finish(finishUrl, 'help.other-workspace.example', stateCookie)
      expect(sessionCookieOf(done)).toBeUndefined()
    })

    it('never mints for a host that is not one of this workspace hosts', async () => {
      const started = await begin()
      const mintUrl = location(started.response)
      mintUrl.searchParams.set('to', 'evil.example')
      const minted = await mintSectionHandoff(
        get(PRIMARY, `${mintUrl.pathname}${mintUrl.search}`, sourceCookie)
      )
      expect(minted.status).toBe(302)
      expect(location(minted).origin).toBe('https://relative.invalid')
      expect(minted.headers.get('location')).toBe('/')
      expect(await handoffRows()).toBe(0)
    })

    it('never mints for a section host that is mapped but not routable', async () => {
      const started = await begin()
      const mintUrl = location(started.response)
      mintUrl.searchParams.set('to', 'roadmap.acme.com')
      const minted = await mintSectionHandoff(
        get(PRIMARY, `${mintUrl.pathname}${mintUrl.search}`, sourceCookie)
      )
      expect(minted.headers.get('location')).toBe('/')
      expect(await handoffRows()).toBe(0)
    })

    it('never bounces to a source host outside the workspace', async () => {
      const response = await beginSectionHandoff(
        get(HELP, '/auth/section-handoff?from=evil.example&returnTo=%2Fhc')
      )
      expect(response.headers.get('location')).toBe('/hc')
      expect(setCookies(response).some((c) => c.startsWith(SECTION_STATE_COOKIE))).toBe(false)
    })

    it('starts nothing on a Host that is not one of this workspace hosts', async () => {
      const response = await beginSectionHandoff(
        get('evil.example', '/auth/section-handoff?from=acme.com&returnTo=%2Fhc')
      )
      expect(response.headers.get('location')).toBe('/hc')
      expect(setCookies(response).some((c) => c.startsWith(SECTION_STATE_COOKIE))).toBe(false)
    })

    it('ignores an unsigned customer-host header claiming the target host', async () => {
      const { stateCookie, finishUrl } = await beginAndMint()
      const done = await finishSectionHandoff(
        new Request(`https://${PRIMARY}${finishUrl.pathname}${finishUrl.search}`, {
          headers: {
            host: PRIMARY,
            cookie: stateCookie,
            'x-quackback-customer-host': HELP,
            'x-forwarded-host': HELP,
          },
        })
      )
      expect(sessionCookieOf(done)).toBeUndefined()
    })
  })

  describe('bound to the browser that started it', () => {
    it('refuses a finish without the state cookie (login CSRF)', async () => {
      const { finishUrl } = await beginAndMint()
      const done = await finish(finishUrl, HELP, '')
      expect(sessionCookieOf(done)).toBeUndefined()
      expect(done.headers.get('location')).toBe('/hc/articles/x?ref=nav')
    })

    it("refuses an attacker's token in a victim browser holding its own state", async () => {
      // The attacker runs legs 1 and 2 for their own session...
      const attacker = await beginAndMint()
      // ...and the victim's browser holds a state cookie from its own begin.
      const victim = await begin()
      const done = await finish(attacker.finishUrl, HELP, victim.stateCookie)
      expect(sessionCookieOf(done)).toBeUndefined()
    })
  })

  describe('signed out and signed in already', () => {
    it('sends a signed-out source to returnTo on the target, signed out, minting nothing', async () => {
      const started = await begin()
      const mintUrl = location(started.response)
      const minted = await mintSectionHandoff(get(PRIMARY, `${mintUrl.pathname}${mintUrl.search}`))
      expect(minted.headers.get('location')).toBe('https://help.acme.com/hc/articles/x?ref=nav')
      expect(await handoffRows()).toBe(0)
    })

    it('goes straight to returnTo when already signed in on the target', async () => {
      const response = await beginSectionHandoff(
        get(HELP, '/auth/section-handoff?from=acme.com&returnTo=%2Fhc', sourceCookie)
      )
      expect(response.headers.get('location')).toBe('/hc')
      expect(setCookies(response)).toHaveLength(0)
    })
  })

  describe('no open redirect', () => {
    it.each(['//evil.example', 'https://evil.example', '/%2F%2Fevil.example', '/\\evil.example'])(
      'lands on / for returnTo %s on every leg',
      async (returnTo) => {
        const { response, finishUrl, stateCookie } = await beginAndMint(HELP, returnTo)
        expect(location(response).searchParams.get('returnTo')).toBe('/')
        expect(finishUrl.searchParams.get('returnTo')).toBe('/')
        const done = await finish(finishUrl, HELP, stateCookie)
        expect(done.headers.get('location')).toBe('/')
      }
    )

    it('re-checks returnTo at the finish, not only at the begin', async () => {
      const { finishUrl, stateCookie } = await beginAndMint()
      finishUrl.searchParams.set('returnTo', '//evil.example')
      const done = await finish(finishUrl, HELP, stateCookie)
      expect(done.headers.get('location')).toBe('/')
    })
  })

  describe('no leaks', () => {
    it('sends no Referer and lets no cache keep any leg', async () => {
      const { response, minted, finishUrl, stateCookie } = await beginAndMint()
      const done = await finish(finishUrl, HELP, stateCookie)
      for (const leg of [response, minted, done]) {
        expect(leg.headers.get('referrer-policy')).toBe('no-referrer')
        expect(leg.headers.get('cache-control')).toBe('no-store')
      }
    })

    it('strips the token: the finish lands on a clean relative path', async () => {
      const { finishUrl, stateCookie } = await beginAndMint()
      const done = await finish(finishUrl, HELP, stateCookie)
      expect(done.headers.get('location')).not.toContain('token')
    })

    it('logs a failure by its kind only, never the error that may quote a credential', async () => {
      // A failed query's message carries its parameters: here, session tokens.
      hoisted.failSession = new Error(`Failed query, params: ${sourceCookie} handoff-token-secret`)
      await beginSectionHandoff(
        get(HELP, '/auth/section-handoff?from=acme.com&returnTo=%2Fhc', sourceCookie)
      )
      expect(hoisted.logCalls.length).toBeGreaterThan(0)
      const logged = hoisted.logCalls.flat()
      expect(
        logged.some(
          (arg) =>
            arg instanceof Error ||
            (!!arg &&
              typeof arg === 'object' &&
              Object.values(arg as object).some((value) => value instanceof Error))
        )
      ).toBe(false)
      expect(JSON.stringify(logged)).not.toContain('handoff-token-secret')
    })

    it('never stores the source session token', async () => {
      await beginAndMint()
      const rows = await testDb
        .select({ value: verification.value })
        .from(verification)
        .where(like(verification.identifier, 'section-handoff:%'))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.value).not.toContain(sourceToken)
    })

    it('never logs the token, on success or failure', async () => {
      const { finishUrl, stateCookie } = await beginAndMint()
      const token = finishUrl.searchParams.get('token')!
      await finish(finishUrl, STATUS, stateCookie)
      await finish(finishUrl, HELP, stateCookie)
      expect(hoisted.logCalls.length).toBeGreaterThan(0)
      expect(JSON.stringify(hoisted.logCalls)).not.toContain(token)
    })
  })

  describe('a hostile target host', () => {
    // Someone who controls a mapped section host (a lapsed domain, a dangling
    // record) sends the owner a mint link with a state of their own choosing.
    // The owner's browser carries the primary domain's session cookie on that
    // cross-site GET, and the finish request lands on the attacker's server,
    // who replays it to the real server with their own state cookie.
    async function attackerFinish() {
      const attackerState = 'attacker-chosen-state'
      const { createHash } = await import('node:crypto')
      const stateHash = createHash('sha256').update(attackerState).digest('hex')
      const minted = await mintSectionHandoff(
        get(
          PRIMARY,
          `/auth/section-handoff?${new URLSearchParams({
            leg: 'mint',
            to: HELP,
            state: stateHash,
            returnTo: '/',
          }).toString()}`,
          sourceCookie
        )
      )
      const finishUrl = location(minted)
      return finish(finishUrl, HELP, `${SECTION_STATE_COOKIE}=${attackerState}`)
    }

    it('never yields the source session or its token', async () => {
      const done = await attackerFinish()
      const installed = sessionCookieOf(done)
      // The attacker does get a session for the owner on that host...
      expect(installed).toBeTruthy()
      expect(installed).not.toContain(sourceToken)
      const carried = await sessionOf(cookiePair(installed!))
      expect(carried?.session.token).not.toBe(sourceToken)
      expect(carried?.session.scope).toBe('portal')
    })

    it('yields nothing that opens /admin', async () => {
      const installed = cookiePair(sessionCookieOf(await attackerFinish())!)
      const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
      const adminGate = () =>
        requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'], callbackUrl: '/admin' } })

      // The source session opens it (so this gate can tell the two apart)...
      hoisted.requestHeaders = new Headers({ cookie: sourceCookie })
      await expect(adminGate()).resolves.toMatchObject({ principal: { role: 'admin' } })

      // ...the handed-off one does not.
      hoisted.requestHeaders = new Headers({ cookie: installed })
      const refused = await adminGate().then(
        () => null,
        (err: { options?: unknown }) => err
      )
      // A redirect to sign-in as a teammate, not the admin page.
      expect(JSON.stringify(refused?.options ?? refused)).toContain('not_team_member')
    })

    it('yields nothing that passes an admin server function gate', async () => {
      const installed = cookiePair(sessionCookieOf(await attackerFinish())!)
      const { requireAuth } = await import('@/lib/server/functions/auth-helpers')

      hoisted.requestHeaders = new Headers({ cookie: sourceCookie })
      await expect(requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })).resolves.toMatchObject(
        { scope: 'dashboard' }
      )

      hoisted.requestHeaders = new Headers({ cookie: installed })
      await expect(requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })).rejects.toThrow(
        /dashboard session/
      )
      const plain = await requireAuth()
      expect(plain.scope).toBe('portal')
      expect(plain.permissions).toEqual([])
      expect(plain.principal.role).toBe('user')
    })

    it('ends the carried session no later than the source session', async () => {
      const installed = cookiePair(sessionCookieOf(await attackerFinish())!)
      const carried = await sessionOf(installed)
      const [source] = await testDb
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(like(session.token, sourceToken))
      const [row] = await testDb
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(like(session.id, carried!.session.id))
      expect(row!.expiresAt.getTime()).toBeLessThanOrEqual(source!.expiresAt.getTime())
    })
  })

  it('does not carry a widget session', async () => {
    await testDb.update(session).set({ scope: 'widget' }).where(like(session.token, sourceToken))
    const { minted } = await beginAndMint()
    expect(location(minted).searchParams.get('token')).toBeNull()
    expect(await handoffRows()).toBe(0)
  })

  describe('signing out ends the sign-in on every host', () => {
    /** Sign out through the production endpoint on `host`, as the browser does. */
    async function signOut(host: string, cookie: string) {
      const auth = await getAuth()
      const response = await auth.handler(
        new Request(`https://${host}/api/auth/sign-out`, {
          method: 'POST',
          headers: {
            host,
            origin: `https://${host}`,
            'content-type': 'application/json',
            cookie,
          },
          body: '{}',
        })
      )
      expect(response.status).toBe(200)
      return response
    }

    /** Carry the session that `fromCookie` stands for from `from` to `target`. */
    async function carry(from: string, fromCookie: string, target: string): Promise<string> {
      const started = await beginSectionHandoffFrom(from, target)
      const mintUrl = location(started.response)
      const minted = await mintSectionHandoff(
        get(from, `${mintUrl.pathname}${mintUrl.search}`, fromCookie)
      )
      const done = await finish(location(minted), target, started.stateCookie)
      const installed = sessionCookieOf(done)
      expect(installed).toBeTruthy()
      return cookiePair(installed!)
    }

    async function beginSectionHandoffFrom(from: string, target: string) {
      const response = await beginSectionHandoff(
        get(
          target,
          `/auth/section-handoff?${new URLSearchParams({ from, returnTo: '/' }).toString()}`
        )
      )
      const stateSetCookie = setCookies(response).find((c) => c.startsWith(SECTION_STATE_COOKIE))
      return { response, stateCookie: stateSetCookie ? cookiePair(stateSetCookie) : '' }
    }

    /** Another session of `userId`, signed in on its own (not handed off). */
    async function separateSession(userId: UserId): Promise<string> {
      const id = `sess-${suffix()}`
      await testDb.insert(session).values({
        id,
        token: `tok${suffix()}${suffix()}`,
        userId,
        scope: 'portal',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      return id
    }

    async function sessionExists(id: string): Promise<boolean> {
      const rows = await testDb.select({ id: session.id }).from(session).where(like(session.id, id))
      return rows.length === 1
    }

    async function linkRows(): Promise<number> {
      const rows = await testDb
        .select({ id: verification.id })
        .from(verification)
        .where(like(verification.identifier, 'section-session-%'))
      return rows.length
    }

    it('signing out on the section host signs the visitor out on the primary domain too', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      expect(await sessionOf(help)).not.toBeNull()

      await signOut(HELP, help)

      expect(await sessionOf(help)).toBeNull()
      expect(await sessionOf(sourceCookie)).toBeNull()
      expect(await linkRows()).toBe(0)
    })

    it('signing out on the primary domain signs the visitor out on every section host', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      const status = await carry(PRIMARY, sourceCookie, STATUS)

      await signOut(PRIMARY, sourceCookie)

      expect(await sessionOf(sourceCookie)).toBeNull()
      expect(await sessionOf(help)).toBeNull()
      expect(await sessionOf(status)).toBeNull()
      expect(await linkRows()).toBe(0)
    })

    it('follows a chain of handoffs: primary to help to status, signed out from the last', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      const status = await carry(HELP, help, STATUS)
      // The primary domain's session ends on its own (expired, or revoked
      // elsewhere); its carried sessions are still found through it.
      await testDb.delete(session).where(like(session.token, sourceToken))
      expect(await sessionOf(status)).not.toBeNull()

      await signOut(STATUS, status)

      expect(await sessionOf(status)).toBeNull()
      expect(await sessionOf(help)).toBeNull()
    })

    it('leaves the same person’s separate sign-ins alone', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      const elsewhere = await separateSession(ownerId)

      await signOut(HELP, help)

      expect(await sessionOf(sourceCookie)).toBeNull()
      expect(await sessionExists(elsewhere)).toBe(true)
    })

    it('never ends another person’s session, even one a link row names', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      const otherId = createId('user') as UserId
      await testDb.insert(user).values({
        id: otherId,
        name: 'Other',
        email: `other-${suffix()}@example.com`,
        emailVerified: true,
      })
      const theirs = await separateSession(otherId)
      const source = await sessionOf(sourceCookie)
      // A row claiming their session came from the owner's sign-in.
      await testDb.insert(verification).values([
        {
          id: crypto.randomUUID(),
          identifier: `section-session-root:${theirs}`,
          value: source!.session.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        {
          id: crypto.randomUUID(),
          identifier: `section-session-family:${source!.session.id}`,
          value: theirs,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      ])

      await signOut(HELP, help)

      expect(await sessionOf(help)).toBeNull()
      expect(await sessionOf(sourceCookie)).toBeNull()
      expect(await sessionExists(theirs)).toBe(true)
    })

    it('ends when the rows loop back on themselves', async () => {
      const a = await separateSession(ownerId)
      const b = await separateSession(ownerId)
      const c = await separateSession(ownerId)
      const row = (identifier: string, value: string) => ({
        id: crypto.randomUUID(),
        identifier,
        value,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      // a says its root is b, b says its root is a; a's family names b and c.
      await testDb
        .insert(verification)
        .values([
          row(`section-session-root:${a}`, b),
          row(`section-session-root:${b}`, a),
          row(`section-session-family:${b}`, a),
          row(`section-session-family:${a}`, b),
          row(`section-session-family:${a}`, c),
        ])
      const { revokeHandoffFamily } = await import('../section-session-family')

      const revoked = await revokeHandoffFamily({ id: a, userId: ownerId })

      expect(revoked).toBeGreaterThan(0)
      expect(await sessionExists(a)).toBe(false)
      expect(await sessionExists(b)).toBe(false)
      expect(await sessionExists(c)).toBe(false)
      expect(await sessionOf(sourceCookie)).not.toBeNull()
    })

    it('ends a long chain in one pass', async () => {
      let cookie = sourceCookie
      const hosts = [HELP, STATUS, PRIMARY, HELP, STATUS, PRIMARY, HELP, STATUS]
      let from = PRIMARY
      const cookies: string[] = [sourceCookie]
      for (const host of hosts) {
        // Each host holds one session at a time: the carried one replaces it.
        cookie = await carry(from, cookie, host)
        cookies.push(cookie)
        from = host
      }

      await signOut(from, cookie)

      for (const each of cookies) expect(await sessionOf(each)).toBeNull()
      expect(await linkRows()).toBe(0)
    })

    it('records where a carried session came from, and nothing else', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      const carried = await sessionOf(help)
      const source = await sessionOf(sourceCookie)
      const rows = await testDb
        .select({ identifier: verification.identifier, value: verification.value })
        .from(verification)
        .where(like(verification.identifier, 'section-session-%'))
      expect(rows).toHaveLength(2)
      expect(rows).toEqual(
        expect.arrayContaining([
          { identifier: `section-session-root:${carried!.session.id}`, value: source!.session.id },
          {
            identifier: `section-session-family:${source!.session.id}`,
            value: carried!.session.id,
          },
        ])
      )
      // Ids only: no session token is written anywhere.
      for (const row of rows) {
        expect(row.value).not.toContain(sourceToken)
        expect(row.value).not.toContain(carried!.session.token)
      }
    })

    it('clears the rows of sessions that ended some other way at the next handoff', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      const carried = await sessionOf(help)
      // The carried session expires or is revoked on its own: its rows stay behind...
      await testDb.delete(session).where(like(session.id, carried!.session.id))
      expect(await linkRows()).toBe(2)

      // ...until the next handoff finishes, which leaves only its own two.
      await carry(PRIMARY, sourceCookie, STATUS)
      expect(await linkRows()).toBe(2)
      const rows = await testDb
        .select({ identifier: verification.identifier, value: verification.value })
        .from(verification)
        .where(like(verification.identifier, 'section-session-%'))
      expect(JSON.stringify(rows)).not.toContain(carried!.session.id)
    })

    it('a handoff that finishes while a sign-out is under way leaves nothing signed in', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      const source = await sessionOf(sourceCookie)
      // A second tab starts carrying the help session on to status...
      const started = await beginSectionHandoffFrom(HELP, STATUS)
      const mintUrl = location(started.response)
      const minted = await mintSectionHandoff(
        get(HELP, `${mintUrl.pathname}${mintUrl.search}`, help)
      )
      expect(location(minted).searchParams.get('token')).toBeTruthy()
      const { revokeHandoffFamily } = await import('../section-session-family')

      // ...and finishes in the middle of the primary domain's sign-out: after
      // the sign-out has read the family, before it ends the members.
      let raced: Response | null = null
      await revokeHandoffFamily(
        { id: source!.session.id, userId: ownerId },
        {
          afterFamilyRead: async () => {
            raced = await finish(location(minted), STATUS, started.stateCookie)
          },
        }
      )

      expect(raced).not.toBeNull()
      const installed = sessionCookieOf(raced!)
      if (installed) expect(await sessionOf(cookiePair(installed))).toBeNull()
      const left = await testDb
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, ownerId))
      expect(left).toEqual([])
    })

    it('keeps the rows for as long as the carried session lives', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      const carried = await sessionOf(help)
      const rowExpiries = async () =>
        (
          await testDb
            .select({ expiresAt: verification.expiresAt })
            .from(verification)
            .where(like(verification.identifier, 'section-session-%'))
        ).map((r) => r.expiresAt.getTime())
      const [row] = await testDb
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(like(session.id, carried!.session.id))
      // They start out ending with the session...
      expect(await rowExpiries()).toEqual([row!.expiresAt.getTime(), row!.expiresAt.getTime()])

      // ...and move with it when the library slides its expiry.
      const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const context = await (await getAuth()).$context
      await context.internalAdapter.updateSession(carried!.session.token, { expiresAt: later })
      expect(await rowExpiries()).toEqual([later.getTime(), later.getTime()])
    })

    it('carries a sign-in no further once its root has ended', async () => {
      const help = await carry(PRIMARY, sourceCookie, HELP)
      await testDb.delete(session).where(like(session.token, sourceToken))

      const started = await beginSectionHandoffFrom(HELP, STATUS)
      const mintUrl = location(started.response)
      const minted = await mintSectionHandoff(
        get(HELP, `${mintUrl.pathname}${mintUrl.search}`, help)
      )
      const done = await finish(location(minted), STATUS, started.stateCookie)

      expect(sessionCookieOf(done)).toBeUndefined()
      // The refused session is gone, and so are its rows.
      const carried = await sessionOf(help)
      const left = await testDb
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, ownerId))
      expect(left.map((r) => r.id)).toEqual([carried!.session.id])
      expect(await linkRows()).toBe(2)
    })

    it('clears expired rows of any family at the next mint', async () => {
      await testDb.insert(verification).values({
        id: crypto.randomUUID(),
        identifier: 'section-session-root:sess-long-gone',
        value: 'sess-root-long-gone',
        expiresAt: new Date(Date.now() - 1000),
      })
      await beginAndMint()
      expect(await linkRows()).toBe(0)
    })

    it('a sign-out with no handoffs ends only its own session', async () => {
      const elsewhere = await separateSession(ownerId)
      await signOut(PRIMARY, sourceCookie)
      expect(await sessionOf(sourceCookie)).toBeNull()
      expect(await sessionExists(elsewhere)).toBe(true)
    })
  })
})
