/**
 * Real-DB coverage for how POST /api/widget/identify binds a signed token to
 * a stored person when the `sub` lookup misses and the email matches.
 *
 * - A person bound to one subject is never moved to another subject by an
 *   email match, unless the token says `email_verified: true`.
 * - `email_verified: false` never joins an existing person by email, creates
 *   new people unverified, and never marks or changes a stored address.
 * - With the claim absent, the first sight of an email whose person has no
 *   subject still joins and stamps the subject.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, user, userAttributeDefinitions } from '@/lib/server/db'
import { createHmac } from 'crypto'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const SECRET = 'identify-email-binding-secret'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(async () => ({ enabled: true })),
  getWidgetSecret: vi.fn(async () => 'identify-email-binding-secret'),
}))

vi.mock('@/lib/server/auth/widget-rate-limit', () => ({
  checkWidgetIdentifyRateLimit: vi.fn(async () => ({ allowed: true })),
}))

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn(async () => undefined),
}))

vi.mock('@/lib/server/domains/changelog/changelog-subscription.service', () => ({
  ensureAutoSubscribed: vi.fn(async () => undefined),
}))

import { Route } from '../identify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: user.id, ext: user.externalId, verified: user.emailVerified })
      .from(user)
      .limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ key: userAttributeDefinitions.key }).from(userAttributeDefinitions).limit(0)
  },
})

type RouteOpts = {
  server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } }
}
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

function sign(payload: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, ...payload })).toString(
    'base64url'
  )
  const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function identify(claims: Record<string, unknown>): Promise<Response> {
  return POST({
    request: new Request('http://test/api/widget/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ssoToken: sign(claims) }),
    }),
  })
}

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(opts: {
  email: string
  externalId: string | null
  emailVerified?: boolean
  role?: 'user' | 'admin'
}): Promise<UserId> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({
    id: userId,
    name: 'Seeded Person',
    email: opts.email,
    emailVerified: opts.emailVerified ?? false,
    externalId: opts.externalId,
  })
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: opts.role ?? 'user',
    type: 'user',
    displayName: 'Seeded Person',
    createdAt: new Date(),
  })
  return userId
}

async function loadUser(where: { id?: UserId; email?: string }) {
  const [row] = await testDb
    .select()
    .from(user)
    .where(where.id ? eq(user.id, where.id) : eq(user.email, where.email ?? ''))
  return row
}

async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as { error?: { code?: string } }
  return body.error?.code
}

describe.skipIf(!fixture.available)('widget identify email binding (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('refuses to move a person bound to one subject onto another subject by email', async () => {
    const email = `bound-${suffix()}@example.com`
    const subA = `sub-a-${suffix()}`
    const userId = await seedPerson({ email, externalId: subA, emailVerified: true })

    const res = await identify({ sub: `sub-b-${suffix()}`, email })

    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('EMAIL_IN_USE')
    expect((await loadUser({ id: userId })).externalId).toBe(subA)
  })

  it('refuses the same rebind for a teammate row', async () => {
    const email = `teammate-${suffix()}@example.com`
    const subA = `sub-a-${suffix()}`
    const userId = await seedPerson({ email, externalId: subA, role: 'admin' })

    const res = await identify({ sub: `sub-b-${suffix()}`, email })

    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('EMAIL_IN_USE')
    expect((await loadUser({ id: userId })).externalId).toBe(subA)
  })

  it('rebinds the subject when the token says the address is verified', async () => {
    const email = `rebind-${suffix()}@example.com`
    const subB = `sub-b-${suffix()}`
    const userId = await seedPerson({ email, externalId: `sub-a-${suffix()}` })

    const res = await identify({ sub: subB, email, email_verified: true })

    expect(res.status).toBe(200)
    expect((await loadUser({ id: userId })).externalId).toBe(subB)
  })

  it('does not join an existing person by an address the host app marks unverified', async () => {
    const email = `unverified-join-${suffix()}@example.com`
    const userId = await seedPerson({ email, externalId: null, emailVerified: false })

    const res = await identify({ sub: `sub-${suffix()}`, email, email_verified: false })

    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('EMAIL_IN_USE')
    const row = await loadUser({ id: userId })
    expect(row.externalId).toBeNull()
    expect(row.emailVerified).toBe(false)
  })

  it('creates a new person unverified when the host app marks the address unverified', async () => {
    const email = `unverified-new-${suffix()}@example.com`
    const sub = `sub-${suffix()}`

    const res = await identify({ sub, email, email_verified: false })

    expect(res.status).toBe(200)
    const row = await loadUser({ email })
    expect(row.externalId).toBe(sub)
    expect(row.emailVerified).toBe(false)
  })

  it('signs a known subject in without verifying or adopting an unverified address', async () => {
    const email = `known-${suffix()}@example.com`
    const sub = `sub-${suffix()}`
    const userId = await seedPerson({ email, externalId: sub, emailVerified: false })

    const res = await identify({
      sub,
      email: `changed-${suffix()}@example.com`,
      email_verified: false,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessionToken?: string; user?: { email?: string } }
    expect(body.sessionToken).toBeTruthy()
    expect(body.user?.email).toBe(email)
    const row = await loadUser({ id: userId })
    expect(row.email).toBe(email)
    expect(row.emailVerified).toBe(false)
  })

  it('joins and stamps the subject on first sight of an unbound email when the claim is absent', async () => {
    const email = `first-sight-${suffix()}@example.com`
    const sub = `sub-${suffix()}`
    const userId = await seedPerson({ email, externalId: null, emailVerified: false })

    const res = await identify({ sub, email })

    expect(res.status).toBe(200)
    const row = await loadUser({ id: userId })
    expect(row.externalId).toBe(sub)
    expect(row.emailVerified).toBe(true)
  })

  it('never stores email_verified as a custom attribute', async () => {
    await testDb
      .insert(userAttributeDefinitions)
      .values({ key: 'email_verified', label: 'Email verified', type: 'boolean' })
    const email = `attrs-${suffix()}@example.com`

    const res = await identify({ sub: `sub-${suffix()}`, email, email_verified: true })

    expect(res.status).toBe(200)
    const row = await loadUser({ email })
    const metadata = JSON.parse(row.metadata ?? '{}') as Record<string, unknown>
    expect(metadata).not.toHaveProperty('email_verified')
  })
})
