// @vitest-environment node
/**
 * Linking a provider to an account, started on a section host, against real
 * Postgres and the PRODUCTION auth instance (`getAuth()`: the real hooks,
 * cookies and trusted origins). The provider's callback and the link's state
 * live on the primary domain, so the link runs there: the section host's
 * `/link-social` answers with an address on the primary domain, the visitor is
 * signed in there through the section handoff when they are not already, the
 * link starts there, and the provider sends them back to the section page
 * they started from.
 *
 * Only the section table, the logger and the provider's credentials are stood
 * in for. The provider's authorize address and the link's stored state are the
 * library's own, so a wrong user, a wrong callback or a missing state shows.
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
import { SECTION_HANDOFF_PATH, SECTION_LINK_PATH } from '@/lib/shared/section-handoff'

vi.hoisted(() => {
  process.env.BASE_URL = 'https://acme.com'
  process.env.SECRET_KEY = 'test-secret-key-for-section-link-0123456789'
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const hoisted = vi.hoisted(() => {
  const log: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'child') return () => log
        if (prop === 'level') return 'info'
        if (prop === 'isLevelEnabled') return () => true
        if (prop === 'then') return undefined
        return () => undefined
      },
    }
  )
  return {
    log,
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
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => new Headers(),
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
// GitHub is set up as a sign-in method; nothing else about the instance changes.
vi.mock(
  '@/lib/server/domains/platform-credentials/platform-credential.service',
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import('@/lib/server/domains/platform-credentials/platform-credential.service')
      >()
    return {
      ...real,
      getPlatformCredentials: async (type: string, ...rest: unknown[]) =>
        type === 'auth_github'
          ? { clientId: 'gh-client-id', clientSecret: 'gh-client-secret' }
          : (real.getPlatformCredentials as (...args: unknown[]) => Promise<unknown>)(
              type,
              ...rest
            ),
    }
  }
)

const { startSectionLink } = await import('../section-link')
const { beginSectionHandoff, mintSectionHandoff, finishSectionHandoff } =
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

function get(host: string, pathAndQuery: string, cookie?: string): Request {
  return new Request(`https://${host}${pathAndQuery}`, {
    headers: { host, ...(cookie ? { cookie } : {}) },
  })
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

async function getAuth() {
  const { getAuth } = await import('@/lib/server/auth/index')
  return getAuth()
}

/** The link states the library stored: who it links and where it returns. */
async function linkStates(): Promise<
  Array<{ callbackURL: string; errorURL?: string; link?: { userId: string } }>
> {
  const rows = await testDb
    .select({ value: verification.value })
    .from(verification)
    .where(like(verification.identifier, 'auth-state:%'))
  return rows.map((row) => JSON.parse(row.value))
}

describe.skipIf(!fixture.available)('linking a provider from a section host', () => {
  let userId: UserId
  /** The user's session cookie on the section host. */
  let helpCookie: string

  async function addUser(name: string): Promise<UserId> {
    const id = createId('user') as UserId
    await testDb.insert(user).values({
      id,
      name,
      email: `${name.toLowerCase()}-${suffix()}@example.com`,
      emailVerified: true,
    })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: id,
      role: 'user',
      displayName: name,
      createdAt: new Date(),
    })
    return id
  }

  /** A session for the user, as the cookie the production instance signs for it. */
  async function signIn(id: UserId): Promise<string> {
    const token = `tok${suffix()}${suffix()}`
    await testDb.insert(session).values({
      id: `sess-${suffix()}`,
      token,
      userId: id,
      scope: 'portal',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    const ott = `ott${suffix()}`
    await testDb.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `one-time-token:${ott}`,
      value: token,
      expiresAt: new Date(Date.now() + 60 * 1000),
    })
    const verified = await (
      await getAuth()
    ).handler(
      new Request('https://acme.com/api/auth/one-time-token/verify', {
        method: 'POST',
        headers: { origin: 'https://acme.com', 'content-type': 'application/json' },
        body: JSON.stringify({ token: ott }),
      })
    )
    const cookie = verified.headers
      .getSetCookie()
      .map(cookiePair)
      .filter((pair) => pair.includes('session_token='))
      .join('; ')
    expect(cookie).toContain('session_token=')
    return cookie
  }

  /** `/link-social` asked for on `host`, as the browser's auth client sends it. */
  async function linkSocial(host: string, cookie: string | null, body: Record<string, unknown>) {
    return (await getAuth()).handler(
      new Request(`https://${host}/api/auth/link-social`, {
        method: 'POST',
        headers: {
          host,
          origin: `https://${host}`,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      })
    )
  }

  /** The address on the primary domain the section host answers with. */
  async function movedLink(
    body: Record<string, unknown> = {
      provider: 'github',
      callbackURL: '/hc/articles/x?ref=nav',
      errorCallbackURL: '/hc?linked=no',
    }
  ): Promise<URL> {
    const response = await linkSocial(HELP, helpCookie, body)
    expect(response.status).toBe(200)
    const answer = (await response.json()) as { url: string; redirect: boolean }
    expect(answer.redirect).toBe(true)
    return new URL(answer.url)
  }

  async function start(url: URL, cookie?: string): Promise<Response> {
    return startSectionLink(get(PRIMARY, `${url.pathname}${url.search}`, cookie))
  }

  /** The handoff from the section host to the primary domain, as the browser runs it. */
  async function handoffToPrimary(beginUrl: URL): Promise<{ landed: URL; cookie: string }> {
    const begun = await beginSectionHandoff(get(PRIMARY, `${beginUrl.pathname}${beginUrl.search}`))
    const stateCookie = begun.headers
      .getSetCookie()
      .map(cookiePair)
      .filter((pair) => pair.includes('section_handoff='))
      .join('; ')
    const mintUrl = location(begun)
    expect(mintUrl.host).toBe(HELP)
    const minted = await mintSectionHandoff(
      get(HELP, `${mintUrl.pathname}${mintUrl.search}`, helpCookie)
    )
    const finishUrl = location(minted)
    expect(finishUrl.host).toBe(PRIMARY)
    const finished = await finishSectionHandoff(
      get(PRIMARY, `${finishUrl.pathname}${finishUrl.search}`, stateCookie)
    )
    const cookie = finished.headers
      .getSetCookie()
      .filter((c) => c.includes('session_token=') && !/max-age=0/i.test(c))
      .map(cookiePair)
      .join('; ')
    return { landed: location(finished), cookie }
  }

  beforeEach(async () => {
    await fixture.begin()
    await ensureMcpOauthResource({
      db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
      table: oauthResource,
      identifier: 'https://acme.com/api/mcp',
      allowedScopes: API_KEY_SCOPES,
    })
    const authConfig = JSON.stringify({ oauth: { github: true } })
    const [existing] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (existing) {
      await testDb.update(settings).set({ authConfig }).where(eq(settings.id, existing.id))
    } else {
      await testDb.insert(settings).values({
        id: createId('workspace'),
        name: 'Acme',
        slug: `acme-${suffix()}`,
        authConfig,
        createdAt: new Date(),
      })
    }
    userId = await addUser('Jo')
    helpCookie = await signIn(userId)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('answers a section host with the link on the primary domain, carrying no session', async () => {
    const url = await movedLink()
    expect(url.origin).toBe('https://acme.com')
    expect(url.pathname).toBe(SECTION_LINK_PATH)
    expect(url.searchParams.get('provider')).toBe('github')
    expect(url.searchParams.get('to')).toBe(HELP)
    expect(url.searchParams.get('returnTo')).toBe('/hc/articles/x?ref=nav')
    expect(url.searchParams.get('errorReturnTo')).toBe('/hc?linked=no')
    // Nothing that signs anyone in rides in the address.
    const token = decodeURIComponent(helpCookie.split('=')[1]!).split('.')[0]!
    expect(url.toString()).not.toContain(token)
    expect(url.toString()).not.toContain(userId)
    // The link did not start on the section host, where its callback could never land.
    expect(await linkStates()).toHaveLength(0)
  })

  it('signs the visitor in on the primary domain through the handoff, then starts the link there', async () => {
    const url = await movedLink()

    const first = await start(url)
    expect(first.status).toBe(302)
    const beginUrl = location(first)
    expect(beginUrl.origin).toBe('https://acme.com')
    expect(beginUrl.pathname).toBe(SECTION_HANDOFF_PATH)
    expect(beginUrl.searchParams.get('from')).toBe(HELP)
    expect(await linkStates()).toHaveLength(0)

    const { landed, cookie } = await handoffToPrimary(beginUrl)
    expect(landed.pathname).toBe(SECTION_LINK_PATH)
    expect(cookie).toContain('session_token=')

    const started = await start(landed, cookie)
    expect(started.status).toBe(302)
    const authorize = location(started)
    expect(authorize.host).toBe('github.com')
    // The provider comes back to the primary domain, where the state is.
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'https://acme.com/api/auth/callback/github'
    )
    const stateCookie = started.headers.getSetCookie().find((c) => c.includes('.state='))
    expect(stateCookie).toBeTruthy()
    expect(stateCookie).not.toMatch(/;\s*domain=/i)

    const [state] = await linkStates()
    expect(state?.link?.userId).toBe(userId)
    // And the link ends on the section page it started from.
    expect(state?.callbackURL).toBe('https://help.acme.com/hc/articles/x?ref=nav')
    expect(state?.errorURL).toBe('https://help.acme.com/hc?linked=no')
  })

  it('starts the link straight away when the visitor is already signed in on the primary domain', async () => {
    const url = await movedLink()
    const primaryCookie = await signIn(userId)
    const started = await start(url, primaryCookie)
    expect(location(started).host).toBe('github.com')
    const [state] = await linkStates()
    expect(state?.link?.userId).toBe(userId)
  })

  it('never links to someone else signed in on the primary domain', async () => {
    const url = await movedLink()
    const otherCookie = await signIn(await addUser('Sam'))
    const refused = await start(url, otherCookie)
    expect(refused.status).toBe(302)
    expect(refused.headers.get('location')).toBe('https://help.acme.com/hc?linked=no')
    expect(await linkStates()).toHaveLength(0)
  })

  it('refuses an address whose return page or host was changed', async () => {
    const primaryCookie = await signIn(userId)
    const changes: Array<(url: URL) => void> = [
      (url) => url.searchParams.set('returnTo', '/somewhere-else'),
      (url) => url.searchParams.set('errorReturnTo', '/somewhere-else'),
      (url) => url.searchParams.set('to', 'status.acme.com'),
      (url) => url.searchParams.set('expires', String(Date.now() + 24 * 60 * 60 * 1000)),
      (url) => url.searchParams.delete('sig'),
    ]
    for (const change of changes) {
      const url = await movedLink()
      change(url)
      const refused = await start(url, primaryCookie)
      expect(refused.status).toBe(302)
      expect(location(refused).host).not.toBe('github.com')
    }
    expect(await linkStates()).toHaveLength(0)
    // The untouched address still starts the link.
    expect(location(await start(await movedLink(), primaryCookie)).host).toBe('github.com')
  })

  it('refuses an address that has expired', async () => {
    const url = await movedLink()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60 * 60 * 1000 })
    try {
      const primaryCookie = await signIn(userId)
      const refused = await start(url, primaryCookie)
      expect(refused.headers.get('location')).toBe('https://help.acme.com/hc?linked=no')
    } finally {
      vi.useRealTimers()
    }
    expect(await linkStates()).toHaveLength(0)
  })

  it('returns to the section page instead of looping when the handoff could not sign them in', async () => {
    const url = await movedLink()
    const beginUrl = location(await start(url))
    const returnTo = new URL(beginUrl.searchParams.get('returnTo')!, 'https://acme.com')
    // Back from a handoff that failed: still signed out on the primary domain.
    const after = await start(returnTo)
    expect(after.headers.get('location')).toBe('https://help.acme.com/hc?linked=no')
  })

  it('sends nobody to a host that is not a section host of this workspace', async () => {
    const primaryCookie = await signIn(userId)
    for (const to of ['evil.example', 'roadmap.acme.com', PRIMARY]) {
      const url = await movedLink()
      url.searchParams.set('to', to)
      const refused = await start(url, primaryCookie)
      expect(refused.headers.get('location')).toBe('/')
    }
    expect(await linkStates()).toHaveLength(0)
  })

  it('runs only on the primary domain', async () => {
    const url = await movedLink()
    const refused = await startSectionLink(get(HELP, `${url.pathname}${url.search}`, helpCookie))
    expect(refused.headers.get('location')).toBe('/')
    expect(await linkStates()).toHaveLength(0)
  })

  it('keeps a return page that points anywhere else on the section host', async () => {
    const url = await movedLink({
      provider: 'github',
      callbackURL: 'https://evil.example/x',
      errorCallbackURL: '//evil.example',
    })
    expect(url.searchParams.get('returnTo')).toBe('/')
    expect(url.searchParams.get('errorReturnTo')).toBe('/')
  })

  it('leaves a link asked for on the primary domain, or by a signed-out visitor, to the library', async () => {
    const primaryCookie = await signIn(userId)
    const onPrimary = await linkSocial(PRIMARY, primaryCookie, {
      provider: 'github',
      callbackURL: '/board',
    })
    expect(onPrimary.status).toBe(200)
    expect(new URL(((await onPrimary.json()) as { url: string }).url).host).toBe('github.com')

    const signedOut = await linkSocial(HELP, null, { provider: 'github', callbackURL: '/hc' })
    expect(signedOut.status).toBe(401)
  })
})
