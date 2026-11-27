/**
 * Real-DB coverage for the language identifyPortalUser records: an API
 * caller's `language` is stored as the detected language when the product
 * has it, only when it changes, and never touches the chosen language.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, user, userAttributeDefinitions } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { identifyPortalUser } from '../user.identify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: user.id, email: user.email, verified: user.emailVerified })
      .from(user)
      .limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ id: userAttributeDefinitions.id }).from(userAttributeDefinitions).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

describe.skipIf(!fixture.available)('identifyPortalUser language', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  async function stored(email: string) {
    const [row] = await testDb.select().from(user).where(eq(user.email, email))
    return row!
  }

  it("records a new person's language as detected, never as chosen", async () => {
    const email = `new-lang-${runSuffix()}@example.com`
    const result = await identifyPortalUser({ email, language: 'pt-PT' })
    expect(result.language).toEqual({ chosen: null, detected: 'pt-br' })
    const row = await stored(email)
    expect(row.detectedLocale).toBe('pt-br')
    expect(row.preferredLanguage).toBeNull()
  })

  it("updates an existing person's detected language only when it changes, and keeps their choice", async () => {
    const email = `known-lang-${runSuffix()}@example.com`
    await identifyPortalUser({ email, language: 'de' })
    await testDb
      .update(user)
      .set({ preferredLanguage: 'nl', detectedLocaleAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(user.email, email))

    await identifyPortalUser({ email, language: 'de-AT' })
    expect((await stored(email)).detectedLocaleAt?.toISOString()).toBe('2020-01-01T00:00:00.000Z')

    const result = await identifyPortalUser({ email, language: 'fr' })
    expect(result.language).toEqual({ chosen: 'nl', detected: 'fr' })
    expect((await stored(email)).preferredLanguage).toBe('nl')
  })

  it('ignores a language the product does not have', async () => {
    const email = `ja-lang-${runSuffix()}@example.com`
    await identifyPortalUser({ email, language: 'es' })
    const result = await identifyPortalUser({ email, language: 'ja-JP' })
    expect(result.language.detected).toBe('es')
  })
})
