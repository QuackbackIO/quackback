/**
 * A link from `mintMagicLinkUrl` signs its recipient in through Better-Auth's own
 * verify endpoint, on real Postgres, and a revoked link does not. Invitations,
 * recovery codes and bootstrap claims all mint through this helper, and the
 * mock-based suite cannot see whether Better-Auth accepts the row it writes.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { eq } from 'drizzle-orm'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { user, verification } from '@/lib/server/db'

vi.hoisted(() => {
  process.env.BASE_URL = 'http://localhost:3000'
  process.env.SECRET_KEY = 'test-secret-key-for-magic-link-mint-0123456789'
})

// The auth hooks read the request's headers; there is no server request here.
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => new Headers(),
}))

// Runs the function's own validator, as the server does.
vi.mock('@tanstack/react-start', () => ({
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

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { mintMagicLinkUrl, revokeMagicLinkToken, revokeMagicLinkTokens } =
  await import('@/lib/server/auth/magic-link-mint')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ identifier: verification.identifier }).from(verification).limit(0)
    await db.select({ id: user.id }).from(user).limit(0)
  },
})

const ORIGIN = 'http://localhost:3000'

async function authHandler() {
  const { getAuth } = await import('@/lib/server/auth/index')
  return getAuth()
}

async function insertUser(): Promise<string> {
  const email = `invitee-${Math.random().toString(36).slice(2, 10)}@example.com`
  await testDb.insert(user).values({
    id: createId('user') as UserId,
    name: 'Invitee',
    email,
    emailVerified: true,
  })
  return email
}

/** The verify call the verify page makes, through Better-Auth's own route. */
function verifyRequest(token: string): Request {
  const query = `token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/admin')}`
  return new Request(`${ORIGIN}/api/auth/magic-link/verify?${query}`, {
    headers: { origin: ORIGIN },
  })
}

function mint(email: string) {
  return mintMagicLinkUrl({ email, callbackPath: '/admin', portalUrl: ORIGIN })
}

describe.skipIf(!fixture.available)('magic-link mint against the real Better-Auth verifier', () => {
  beforeEach(async () => {
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('a minted link signs its recipient in', async () => {
    const email = await insertUser()
    const { token } = await mint(email)

    const auth = await authHandler()
    const res = await auth.handler(verifyRequest(token))

    const location = res.headers.get('location') ?? ''
    expect(location, `verify redirected to ${location}`).not.toContain('error=')
    expect(res.headers.get('set-cookie') ?? '').toContain('better-auth.session_token=')
  })

  it('stores the row under the prefixed identifier with the strict record shape', async () => {
    const email = await insertUser()
    const { token } = await mint(email)

    const rows = await testDb
      .select({ value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, `magic-link:${token}`))
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].value)).toEqual({ type: 'magic-link', email })
  })

  it('revoking a link removes its row, so it can no longer sign in', async () => {
    const email = await insertUser()
    const { token } = await mint(email)
    const rowsFor = () =>
      testDb
        .select({ identifier: verification.identifier })
        .from(verification)
        .where(eq(verification.identifier, `magic-link:${token}`))
    // The row must exist first, or the verify below would fail for a different reason.
    expect(await rowsFor()).toHaveLength(1)

    await revokeMagicLinkToken(token)

    expect(await rowsFor()).toHaveLength(0)
    const auth = await authHandler()
    const res = await auth.handler(verifyRequest(token))
    expect(res.headers.get('location') ?? '').toContain('error=INVALID_TOKEN')
  })

  it('revoking a set also removes a row written under the bare token', async () => {
    const email = await insertUser()
    const { token } = await mint(email)
    // A link minted before the prefix stored the bare token as its identifier.
    await testDb
      .update(verification)
      .set({ identifier: token })
      .where(eq(verification.identifier, `magic-link:${token}`))

    await revokeMagicLinkTokens([token])

    const rows = await testDb
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(eq(verification.identifier, token))
    expect(rows).toHaveLength(0)
  })
})
