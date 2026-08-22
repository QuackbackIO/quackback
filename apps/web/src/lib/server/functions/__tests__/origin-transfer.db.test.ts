// @vitest-environment node
/**
 * Rename-transfer handoff against real Postgres.
 *
 * After a friendly URL change the browser crosses hosts with a one-use token
 * stored as `verification.identifier = one-time-token:<token>`. A double that
 * answers "valid / invalid" cannot tell a replay from an expiry from a token
 * that belongs to another workspace: those three are three different rows.
 * The host check must also refuse without deleting the row, or presenting the
 * token on the leftover system host would burn the only transfer.
 *
 * Every write rolls back with the fixture transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { oneTimeToken } from 'better-auth/plugins'
import { createId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { user, session, account, verification, settings, eq, sql } from '@/lib/server/db'
import type { IdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  setResponseHeader: vi.fn(),
}))

const hoisted = vi.hoisted(() => {
  const handler = vi.fn()
  return {
    handler,
    auth: {
      handler: (...args: unknown[]) => handler(...args),
    },
  }
})

vi.mock('@/lib/server/auth', () => ({ auth: hoisted.auth }))

import { consumeOpenHandoff, consumeOriginTransfer } from '../origin-transfer'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: session.id, token: session.token }).from(session).limit(0)
    await db.select({ identifier: verification.identifier }).from(verification).limit(0)
    await db.execute(sql`select cloud_identity from settings limit 0`)
  },
})

const CANONICAL = 'https://acme.quackback.co.uk'
const SYSTEM_HOST = 'ws-abc123.quackback.co.uk'
const FRIENDLY_HOST = 'acme.quackback.co.uk'

const IDENTITY: IdentityProjection = {
  version: 2,
  displayName: 'Acme Feedback',
  canonicalOrigin: CANONICAL,
  platformHostname: FRIENDLY_HOST,
  customDomains: [],
  updatedAt: '2026-08-14T12:00:00.000Z',
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

async function seedIdentity(projection: IdentityProjection | null): Promise<void> {
  const existing = await testDb.select({ id: settings.id }).from(settings)
  if (existing.length === 0) {
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Acme',
      slug: `acme-${suffix()}`,
      createdAt: new Date(),
      cloudIdentity: projection ?? undefined,
    })
    return
  }
  await testDb.update(settings).set({ cloudIdentity: projection })
}

async function seedSessionUser(): Promise<{ sessionToken: string }> {
  const userId = createId('user') as UserId
  const sessionToken = `sess-tok-${suffix()}`
  await testDb.insert(user).values({
    id: userId,
    name: 'Owner',
    email: `owner-${suffix()}@acme.example`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await testDb.insert(session).values({
    id: `sess-${suffix()}`,
    token: sessionToken,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    updatedAt: new Date(),
    userId,
  })
  return { sessionToken }
}

async function seedOtt(opts: { sessionToken: string; expiresAt: Date }): Promise<string> {
  const token = `ott-${suffix()}`
  await testDb.insert(verification).values({
    id: `ver-${suffix()}`,
    identifier: `one-time-token:${token}`,
    value: opts.sessionToken,
    expiresAt: opts.expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return token
}

async function ottRowCount(token: string): Promise<number> {
  const rows = await testDb
    .select({ id: verification.id })
    .from(verification)
    .where(eq(verification.identifier, `one-time-token:${token}`))
  return rows.length
}

function future(): Date {
  return new Date(Date.now() + 10 * 60 * 1000)
}

function past(): Date {
  return new Date(Date.now() - 60 * 1000)
}

describe.skipIf(!fixture.available)('rename-transfer OTT consume', () => {
  beforeEach(async () => {
    await fixture.begin()
    hoisted.handler.mockReset()
    const auth = betterAuth({
      baseURL: CANONICAL,
      secret: 'test-secret-not-used-for-anything-real',
      database: drizzleAdapter(testDb, {
        provider: 'pg',
        schema: { user, session, account, verification },
      }),
      emailAndPassword: { enabled: true },
      plugins: [oneTimeToken({ expiresIn: 10 })],
    })
    hoisted.handler.mockImplementation((request: unknown) => auth.handler(request as Request))
    await seedIdentity(IDENTITY)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('establishes the session on the new canonical host and burns the token', async () => {
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: future() })

    const result = await consumeOriginTransfer({ ott: token, host: FRIENDLY_HOST })

    expect(result).toMatchObject({ kind: 'redirect', to: '/admin/settings/general' })
    if (result.kind !== 'redirect') return
    expect(result.cookies.some((cookie) => cookie.toLowerCase().includes('session'))).toBe(true)
    expect(await ottRowCount(token)).toBe(0)
  })

  it('refuses a replay and leaves no session cookie', async () => {
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: future() })

    const first = await consumeOriginTransfer({ ott: token, host: FRIENDLY_HOST })
    expect(first.kind).toBe('redirect')

    const replay = await consumeOriginTransfer({ ott: token, host: FRIENDLY_HOST })
    expect(replay).toEqual({ kind: 'error', status: 'invalid' })
    expect(await ottRowCount(token)).toBe(0)
  })

  it('refuses an expired token after consuming the row', async () => {
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: past() })

    const result = await consumeOriginTransfer({ ott: token, host: FRIENDLY_HOST })
    expect(result).toEqual({ kind: 'error', status: 'invalid' })
    expect(await ottRowCount(token)).toBe(0)
  })

  it('refuses the leftover system host without burning the token', async () => {
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: future() })

    const wrong = await consumeOriginTransfer({ ott: token, host: SYSTEM_HOST })
    expect(wrong).toEqual({ kind: 'error', status: 'invalid' })
    expect(await ottRowCount(token)).toBe(1)
    expect(hoisted.handler).not.toHaveBeenCalled()

    const right = await consumeOriginTransfer({ ott: token, host: FRIENDLY_HOST })
    expect(right.kind).toBe('redirect')
    expect(await ottRowCount(token)).toBe(0)
  })

  it('refuses another workspace host without burning the token', async () => {
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: future() })

    const result = await consumeOriginTransfer({
      ott: token,
      host: 'other.quackback.co.uk',
    })
    expect(result).toEqual({ kind: 'error', status: 'invalid' })
    expect(await ottRowCount(token)).toBe(1)
    expect(hoisted.handler).not.toHaveBeenCalled()
  })

  it('refuses a token that does not exist in this workspace', async () => {
    const result = await consumeOriginTransfer({
      ott: 'ott-from-another-workspace',
      host: FRIENDLY_HOST,
    })
    expect(result).toEqual({ kind: 'error', status: 'invalid' })
  })

  it('refuses when this workspace has no identity projection', async () => {
    await seedIdentity(null)
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: future() })

    const result = await consumeOriginTransfer({ ott: token, host: FRIENDLY_HOST })
    expect(result).toEqual({ kind: 'error', status: 'invalid' })
    expect(await ottRowCount(token)).toBe(1)
    expect(hoisted.handler).not.toHaveBeenCalled()
  })

  it('lets Visit replay the Open token until it expires', async () => {
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: future() })

    const first = await consumeOpenHandoff({ ott: token })
    expect(first).toMatchObject({ kind: 'redirect', to: '/' })
    if (first.kind !== 'redirect') return
    expect(first.cookies.some((cookie) => cookie.toLowerCase().includes('session'))).toBe(true)
    expect(await ottRowCount(token)).toBe(1)

    const replay = await consumeOpenHandoff({ ott: token })
    expect(replay).toMatchObject({ kind: 'redirect', to: '/' })
    if (replay.kind !== 'redirect') return
    expect(replay.cookies.some((cookie) => cookie.toLowerCase().includes('session'))).toBe(true)
    expect(await ottRowCount(token)).toBe(1)
  })

  it('still refuses an expired Open token', async () => {
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: past() })

    const result = await consumeOpenHandoff({ ott: token })
    expect(result).toEqual({ kind: 'error', status: 'invalid' })
  })

  it('retries Open when a parallel GET snapshots after the sibling consume', async () => {
    const { sessionToken } = await seedSessionUser()
    const token = await seedOtt({ sessionToken, expiresAt: future() })
    const [row] = await testDb
      .select()
      .from(verification)
      .where(eq(verification.identifier, `one-time-token:${token}`))
      .limit(1)
    expect(row).toBeTruthy()
    await testDb.delete(verification).where(eq(verification.identifier, `one-time-token:${token}`))

    const pending = consumeOpenHandoff({ ott: token })
    await new Promise((resolve) => setTimeout(resolve, 40))
    await testDb.insert(verification).values(row!)

    const result = await pending
    expect(result).toMatchObject({ kind: 'redirect', to: '/' })
    expect(await ottRowCount(token)).toBe(1)
  })
})
