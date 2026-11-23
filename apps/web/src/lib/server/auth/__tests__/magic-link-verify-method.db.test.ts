// @vitest-environment node
/**
 * The "Email magic link" method at the real `/magic-link/verify`, against
 * Postgres and the production auth instance.
 *
 * A link a person asked for by typing their address (an email sign-in link,
 * marked at mint) stops verifying once the method is off, and its row is left
 * for its own expiry. A link the workspace granted (an invitation, a recovery
 * code, the claim) verifies whatever the method says, since off is the
 * default and those are how people get in.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, oauthResource, settings, user, verification } from '@/lib/server/db'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'

vi.hoisted(() => {
  process.env.BASE_URL = 'https://magic-link-method.example'
  process.env.SECRET_KEY = 'test-secret-key-for-magic-link-method-0123456789'
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
  return { log }
})

vi.mock('@/lib/server/logger', () => ({ logger: hoisted.log }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => new Headers(),
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ identifier: verification.identifier }).from(verification).limit(0)
  },
})

const HOST = 'magic-link-method.example'
const ORIGIN = `https://${HOST}`

const suffix = () => Math.random().toString(36).slice(2, 10)

async function getAuth() {
  const { getAuth } = await import('@/lib/server/auth/index')
  return getAuth()
}

describe.skipIf(!fixture.available)('the Email magic link method at the verifier', () => {
  let email: string

  async function setMethod(on: boolean) {
    const authConfig = JSON.stringify({ oauth: { password: true, magicLink: on } })
    const [existing] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (existing) {
      await testDb.update(settings).set({ authConfig }).where(eq(settings.id, existing.id))
    } else {
      await testDb.insert(settings).values({
        id: createId('workspace'),
        name: 'Acme',
        slug: `acme-${suffix()}`,
        createdAt: new Date(),
        authConfig,
      })
    }
  }

  async function mint(purpose?: 'email-signin') {
    const { mintMagicLinkUrl } = await import('@/lib/server/auth/magic-link-mint')
    return mintMagicLinkUrl({ email, callbackPath: '/roadmap', portalUrl: ORIGIN, purpose })
  }

  async function verify(token: string): Promise<Response> {
    const auth = await getAuth()
    const query = new URLSearchParams({ token, callbackURL: '/roadmap' })
    return auth.handler(
      new Request(`${ORIGIN}/api/auth/magic-link/verify?${query.toString()}`, {
        headers: { host: HOST },
      })
    )
  }

  function signedIn(res: Response): boolean {
    const location = res.headers.get('location') ?? ''
    return !location.includes('error=') && !!res.headers.get('set-auth-token')
  }

  async function rowsFor(token: string) {
    return testDb
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(eq(verification.identifier, `magic-link:${token}`))
  }

  beforeEach(async () => {
    await fixture.begin()
    await ensureMcpOauthResource({
      db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
      table: oauthResource,
      identifier: `${ORIGIN}/api/mcp`,
      allowedScopes: API_KEY_SCOPES,
    })
    email = `person-${suffix()}@example.com`
    await testDb
      .insert(user)
      .values({ id: createId('user') as UserId, name: 'Person', email, emailVerified: true })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('signs in with an email sign-in link while the method is on (the control)', async () => {
    await setMethod(true)
    const { token } = await mint('email-signin')

    expect(signedIn(await verify(token))).toBe(true)
  })

  it('refuses an email sign-in link once the method is off, and leaves its row', async () => {
    await setMethod(false)
    const { token } = await mint('email-signin')

    const res = await verify(token)

    expect(signedIn(res)).toBe(false)
    expect(res.headers.get('location')).toContain('error=magic_link_method_not_allowed')
    expect(await rowsFor(token)).toHaveLength(1)
  })

  it('signs in with a link the workspace granted while the method is off', async () => {
    await setMethod(false)
    const { token } = await mint()

    expect(signedIn(await verify(token))).toBe(true)
  })
})
