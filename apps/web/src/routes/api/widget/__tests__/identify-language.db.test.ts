/**
 * Real-DB coverage for the language a widget identify records and returns:
 * the host page's locale (else the browser's) is the person's detected
 * language, written only when it changes and never on a teammate's row; the
 * person's chosen language comes back for the widget to show.
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

const SECRET = 'identify-language-secret'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(async () => ({ enabled: true })),
  getWidgetSecret: vi.fn(async () => 'identify-language-secret'),
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
    await db.select({ id: user.id, detected: user.detectedLocale }).from(user).limit(0)
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

function identify(
  claims: Record<string, unknown>,
  opts: { locale?: string; acceptLanguage?: string } = {}
): Promise<Response> {
  return POST({
    request: new Request('http://test/api/widget/identify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.acceptLanguage ? { 'accept-language': opts.acceptLanguage } : {}),
      },
      body: JSON.stringify({
        ssoToken: sign(claims),
        ...(opts.locale ? { locale: opts.locale } : {}),
      }),
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

describe.skipIf(!fixture.available)('widget identify language (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("records the host page's locale as a new person's detected language", async () => {
    const email = `new-${suffix()}@example.com`
    const res = await identify(
      { sub: `ext-${suffix()}`, email },
      { locale: 'de-DE', acceptLanguage: 'fr' }
    )
    expect(res.status).toBe(200)
    const row = await loadUser({ email })
    expect(row?.detectedLocale).toBe('de')
    expect(row?.detectedLocaleAt).toBeInstanceOf(Date)
  })

  it('records the browser language when the host page set none, and only when it changes', async () => {
    const email = `known-${suffix()}@example.com`
    const userId = await seedPerson({ email, externalId: null })
    await identify({ sub: `ext-${suffix()}`, email }, { acceptLanguage: 'nl-NL,nl;q=0.9' })
    const first = await loadUser({ id: userId })
    expect(first?.detectedLocale).toBe('nl')

    await testDb
      .update(user)
      .set({ detectedLocaleAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(user.id, userId))
    await identify({ sub: first!.externalId!, email }, { acceptLanguage: 'nl' })
    const same = await loadUser({ id: userId })
    expect(same?.detectedLocaleAt?.toISOString()).toBe('2020-01-01T00:00:00.000Z')

    await identify({ sub: first!.externalId!, email }, { acceptLanguage: 'pl' })
    expect((await loadUser({ id: userId }))?.detectedLocale).toBe('pl')
  })

  it('keeps the stored language when the request names none the product has', async () => {
    const email = `ja-${suffix()}@example.com`
    const userId = await seedPerson({ email, externalId: null })
    await testDb.update(user).set({ detectedLocale: 'fr' }).where(eq(user.id, userId))
    await identify({ sub: `ext-${suffix()}`, email }, { acceptLanguage: 'ja-JP' })
    expect((await loadUser({ id: userId }))?.detectedLocale).toBe('fr')
  })

  it("never writes a teammate's detected language", async () => {
    const email = `mate-${suffix()}@example.com`
    const userId = await seedPerson({ email, externalId: null, role: 'admin' })
    await identify({ sub: `ext-${suffix()}`, email }, { locale: 'de' })
    expect((await loadUser({ id: userId }))?.detectedLocale).toBeNull()
  })

  it("returns the person's chosen language, or null for Automatic", async () => {
    const email = `chosen-${suffix()}@example.com`
    const userId = await seedPerson({ email, externalId: null })
    const automatic = (await (await identify({ sub: `ext-${suffix()}`, email })).json()) as {
      language: string | null
    }
    expect(automatic.language).toBeNull()

    await testDb.update(user).set({ preferredLanguage: 'pt-BR' }).where(eq(user.id, userId))
    const row = await loadUser({ id: userId })
    const chosen = (await (await identify({ sub: row!.externalId!, email })).json()) as {
      language: string | null
    }
    expect(chosen.language).toBe('pt-br')
  })
})
