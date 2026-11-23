// @vitest-environment node
/**
 * "Require two-factor authentication" on the server, against real Postgres and
 * the production auth instance (`getAuth()`: the real hooks and plugins).
 *
 * The setting was enforced only by the sign-in dialog, so a direct
 * `/sign-in/email` by a person who had not enrolled got a working session. Now
 * that sign-in gets a session that can only finish enrolment or sign out: every
 * session read answers null, and other endpoints refuse it. Enrolling through
 * the library's own endpoints, with that session, replaces it with an ordinary
 * one, which is what the dialog does.
 *
 * Only the logger and request headers are stood in for. Every write rolls back
 * with the fixture transaction.
 */
import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { account, eq, oauthResource, principal, session, settings, user } from '@/lib/server/db'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'

vi.hoisted(() => {
  process.env.BASE_URL = 'https://two-factor.example'
  process.env.SECRET_KEY = 'test-secret-key-for-two-factor-pending-0123456789'
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
    await db.select({ id: session.id, pending: session.twoFactorPending }).from(session).limit(0)
  },
})

const HOST = 'two-factor.example'
const ORIGIN = `https://${HOST}`
const PASSWORD = 'correct-horse-battery-staple'

const suffix = () => Math.random().toString(36).slice(2, 10)

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** The current code for an `otpauth://` URI (RFC 6238, SHA-1, 6 digits, 30 s). */
function totp(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret') ?? ''
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)))
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = mac[mac.length - 1]! & 0xf
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

async function getAuth() {
  const { getAuth } = await import('@/lib/server/auth/index')
  return getAuth()
}

/** A request to the auth handler, authenticated by `token` when given. */
async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { token?: string; cookie?: string; authorization?: string; body?: unknown } = {}
): Promise<Response> {
  const auth = await getAuth()
  const headers: Record<string, string> = { host: HOST, origin: ORIGIN }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.authorization) headers.authorization = opts.authorization
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  )
}

async function sessionOf(token: string): Promise<{ user: { email: string } } | null> {
  const res = await call('GET', '/get-session', { token })
  expect(res.status).toBe(200)
  return (await res.json()) as { user: { email: string } } | null
}

describe.skipIf(!fixture.available)('required two-factor, on the server', () => {
  let email: string

  async function setRequired(required: boolean) {
    const authConfig = JSON.stringify({
      oauth: { password: true },
      twoFactor: { required },
    })
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

  async function signIn(): Promise<string> {
    const res = await call('POST', '/sign-in/email', { body: { email, password: PASSWORD } })
    expect(res.status, await res.clone().text()).toBe(200)
    const token = res.headers.get('set-auth-token')
    expect(token).toBeTruthy()
    return token!
  }

  beforeEach(async () => {
    await fixture.begin()
    await ensureMcpOauthResource({
      db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
      table: oauthResource,
      identifier: `${ORIGIN}/api/mcp`,
      allowedScopes: API_KEY_SCOPES,
    })
    const userId = createId('user') as UserId
    email = `person-${suffix()}@example.com`
    await testDb.insert(user).values({ id: userId, name: 'Person', email, emailVerified: true })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId,
      role: 'user',
      displayName: 'Person',
      createdAt: new Date(),
    })
    const context = await (await getAuth()).$context
    await testDb.insert(account).values({
      id: createId('account' as never) as unknown as string,
      accountId: userId,
      providerId: 'credential',
      userId,
      password: await context.password.hash(PASSWORD),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof account.$inferInsert)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('gives an ordinary session when two-factor is not required (the control)', async () => {
    await setRequired(false)
    const token = await signIn()

    expect((await sessionOf(token))?.user.email).toBe(email)
  })

  it('gives an un-enrolled password sign-in no usable session', async () => {
    await setRequired(true)
    const token = await signIn()

    expect(await sessionOf(token)).toBeNull()
    const auth = await getAuth()
    const inProcess = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })
    expect(inProcess).toBeNull()
  })

  it('refuses the pending session everywhere but enrolment and sign-out', async () => {
    await setRequired(true)
    const token = await signIn()

    // A one-time token would trade it for an ordinary session.
    expect((await call('GET', '/one-time-token/generate', { token })).status).toBe(403)
    expect((await call('GET', '/list-sessions', { token })).status).toBe(403)
    expect(
      (await call('POST', '/update-user', { token, body: { name: 'Someone else' } })).status
    ).toBe(403)

    // Walking away from enrolment and signing in again is not refused.
    const again = await call('POST', '/sign-in/email', {
      token,
      body: { email, password: PASSWORD },
    })
    expect(again.status).toBe(200)
  })

  // A browser holds the session as a cookie, named `__Secure-…` on https. The
  // gate has to read it under that name too, or a cookie walks past it.
  it('refuses the pending session sent as the browser sends it, a secure cookie', async () => {
    await setRequired(true)
    const res = await call('POST', '/sign-in/email', { body: { email, password: PASSWORD } })
    expect(res.status).toBe(200)
    const set = res.headers
      .getSetCookie()
      .find((c) => /^__Secure-better-auth\.session_token=/.test(c))
    expect(set, 'an https sign-in sets the secure session cookie').toBeTruthy()
    const cookie = set!.split(';')[0]!

    const read = await call('GET', '/get-session', { cookie })
    expect(await read.json()).toBeNull()
    expect((await call('GET', '/one-time-token/generate', { cookie })).status).toBe(403)
    expect((await call('GET', '/list-sessions', { cookie })).status).toBe(403)
    expect(
      (await call('POST', '/update-user', { cookie, body: { name: 'Someone else' } })).status
    ).toBe(403)
  })

  // Which credential the library reads is not the gate's to guess: a decoy
  // the library ignores must not be the one the gate checks.
  // The bearer plugin percent-decodes a signed token before it uses it, so an
  // encoded spelling of the pending token is the same session to the library.
  it('refuses the pending session as a percent-encoded Bearer', async () => {
    await setRequired(true)
    const token = await signIn()
    expect(token).toContain('.')
    const encoded = `%${token.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}${token.slice(1)}`

    const res = await call('POST', '/update-user', {
      authorization: `Bearer ${encoded}`,
      body: { name: 'Someone else' },
    })
    expect(res.status).toBe(403)
  })

  it('refuses the pending cookie behind a decoy credential', async () => {
    await setRequired(true)
    const res = await call('POST', '/sign-in/email', { body: { email, password: PASSWORD } })
    const set = res.headers
      .getSetCookie()
      .find((c) => /^__Secure-better-auth\.session_token=/.test(c))
    const pending = set!.split(';')[0]!

    // A Bearer the library cannot verify, so it falls back to the cookie.
    const junkBearer = await call('POST', '/update-user', {
      authorization: 'Bearer junk.x',
      cookie: pending,
      body: { name: 'Someone else' },
    })
    expect(junkBearer.status).toBe(403)

    // A plain-named decoy cookie beside the secure one.
    const decoyCookie = await call('POST', '/update-user', {
      cookie: `better-auth.session_token=x.y; ${pending}`,
      body: { name: 'Someone else' },
    })
    expect(decoyCookie.status).toBe(403)
    expect(
      (
        await call('GET', '/one-time-token/generate', {
          cookie: `better-auth.session_token=x.y; ${pending}`,
        })
      ).status
    ).toBe(403)
  })

  it('becomes an ordinary session once the person enrols, as the dialog does', async () => {
    await setRequired(true)
    const token = await signIn()

    const enable = await call('POST', '/two-factor/enable', {
      token,
      body: { password: PASSWORD },
    })
    expect(enable.status, await enable.clone().text()).toBe(200)
    const { totpURI } = (await enable.json()) as { totpURI: string }

    const verify = await call('POST', '/two-factor/verify-totp', {
      token,
      body: { code: totp(totpURI) },
    })
    expect(verify.status, await verify.clone().text()).toBe(200)
    const enrolled = verify.headers.get('set-auth-token')
    expect(enrolled).toBeTruthy()

    expect((await sessionOf(enrolled!))?.user.email).toBe(email)
    // The pending session is gone, not promoted.
    expect(await sessionOf(token)).toBeNull()
  })
})
