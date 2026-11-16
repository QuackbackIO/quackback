// @vitest-environment node
/**
 * Signing in across section hosts, against real Postgres and a real Better
 * Auth instance. The workspace serves acme.com (primary), help.acme.com and
 * status.acme.com. Each test drives the three legs as the browser would:
 * begin on the target, mint on the source, finish on the target.
 *
 * A double that answers "valid" or "invalid" cannot tell a replay from an
 * expiry from a token for another host, so the token rows are real rows and
 * the session cookie comes from the library itself.
 *
 * Every write rolls back with the fixture transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { oneTimeToken } from 'better-auth/plugins'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { user, session, account, verification, like } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const hoisted = vi.hoisted(() => {
  const handler = vi.fn()
  const getSession = vi.fn()
  const logCalls: unknown[][] = []
  const record =
    () =>
    (...args: unknown[]) => {
      logCalls.push(args)
    }
  const log = {
    info: record(),
    warn: record(),
    error: record(),
    debug: record(),
    child: () => log,
  }
  return {
    handler,
    getSession,
    logCalls,
    log,
    auth: {
      handler: (...args: unknown[]) => handler(...args),
      api: { getSession: (...args: unknown[]) => getSession(...args) },
    },
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

vi.mock('@/lib/server/auth', () => ({ auth: hoisted.auth }))
vi.mock('@/lib/server/logger', () => ({ logger: hoisted.log }))
vi.mock('@/lib/server/domains/settings/section-links', () => ({
  getSectionOrigins: async () => hoisted.origins,
}))

const { beginSectionHandoff, mintSectionHandoff, finishSectionHandoff, SECTION_STATE_COOKIE } =
  await import('../section-handoff')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: session.id, token: session.token }).from(session).limit(0)
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
  let sourceCookie: string
  let realGetSession: (args: { headers: Headers }) => Promise<unknown>

  beforeEach(async () => {
    await fixture.begin()
    hoisted.handler.mockReset()
    hoisted.getSession.mockReset()
    hoisted.logCalls.length = 0
    const auth = betterAuth({
      baseURL: 'https://acme.com',
      secret: 'test-secret-not-used-for-anything-real-0123456789',
      trustedOrigins: ['https://acme.com'],
      database: drizzleAdapter(testDb, {
        provider: 'pg',
        schema: { user, session, account, verification },
      }),
      emailAndPassword: { enabled: true },
      advanced: {
        defaultCookieAttributes: { sameSite: 'lax', secure: true },
        database: {
          generateId: ({ model }) => (model === 'user' ? createId('user') : crypto.randomUUID()),
        },
      },
      plugins: [oneTimeToken({ expiresIn: 10 })],
    })
    hoisted.handler.mockImplementation((request: Request) => auth.handler(request))
    realGetSession = (args) => auth.api.getSession(args)
    hoisted.getSession.mockImplementation((args: { headers: Headers }) => realGetSession(args))

    const signUp = await auth.api.signUpEmail({
      body: {
        email: `jo-${suffix()}@example.com`,
        password: 'correct-horse-battery',
        name: 'Jo',
      },
      asResponse: true,
    })
    sourceCookie = signUp.headers
      .getSetCookie()
      .map(cookiePair)
      .filter((pair) => pair.includes('session_token'))
      .join('; ')
    expect(sourceCookie).toContain('session_token=')
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
    // The same session the source holds, signed in on the target.
    const session = await realGetSession({
      headers: new Headers({ cookie: cookiePair(installed!) }),
    })
    const source = await realGetSession({ headers: new Headers({ cookie: sourceCookie }) })
    expect((session as { user: { id: string } }).user.id).toBe(
      (source as { user: { id: string } }).user.id
    )
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

    it('reads the host the edge vouches for, not a spoofed Host header', async () => {
      // A request whose Host is help.acme.com but whose URL says another host
      // still resolves to the Host header (requestWorkspaceHost). A Host that
      // is not a workspace host gets nothing.
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
      hoisted.getSession.mockRejectedValue(
        new Error(`Failed query, params: ${sourceCookie} handoff-token-secret`)
      )
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

    it('never logs the token, on success or failure', async () => {
      const { finishUrl, stateCookie } = await beginAndMint()
      const token = finishUrl.searchParams.get('token')!
      await finish(finishUrl, STATUS, stateCookie)
      await finish(finishUrl, HELP, stateCookie)
      expect(hoisted.logCalls.length).toBeGreaterThan(0)
      expect(JSON.stringify(hoisted.logCalls)).not.toContain(token)
    })
  })
})
