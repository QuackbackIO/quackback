/**
 * A person's own language, on a real database: the Preferences row saves one
 * of the product's languages (or clears it for "Automatic") on the caller's
 * own row only, and the detected language a sign-in records is written only
 * when it changes and never from a request naming no language the product has.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, user } from '@/lib/server/db'

const hoisted = vi.hoisted(() => ({
  userId: '' as string,
  acceptLanguage: 'fr-FR' as string | null,
  language: { mainLanguage: 'de', visitorLanguage: 'own' as 'own' | 'main' },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (schema: { parse: (v: unknown) => unknown }) => ({
      handler:
        (fn: (args: { data: unknown }) => unknown) =>
        async ({ data }: { data: unknown }) =>
          fn({ data: schema.parse(data) }),
    }),
    handler: (fn: () => unknown) => fn,
  }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () =>
    new Headers(hoisted.acceptLanguage ? { 'accept-language': hoisted.acceptLanguage } : {}),
}))
vi.mock('../auth-helpers', () => ({
  requireAuth: async () => ({ user: { id: hoisted.userId } }),
}))
// The session's user, as Better Auth reads it from the row for each request.
vi.mock('@/lib/server/auth/request-session', () => ({
  getRequestSession: async () => {
    const { testDb: tx } = await import('@/lib/server/__tests__/db-test-fixture')
    const { user: table, eq: same } = await import('@/lib/server/db')
    const [row] = await tx
      .select()
      .from(table)
      .where(same(table.id, hoisted.userId as UserId))
    return { user: row }
  },
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getLanguageConfig: async () => hoisted.language,
}))

import { getMyLanguageFn, setMyLanguageFn } from '../person-language'
import { handleDetectedLocaleCapture, recordDetectedLocale } from '@/lib/server/auth/locale-capture'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id, detected: user.detectedLocale }).from(user).limit(0)
  },
})

async function seedUser(): Promise<UserId> {
  const id = createId('user') as UserId
  await testDb.insert(user).values({ id, name: 'Sam', email: `${id}@example.com` })
  return id
}

async function row(id: UserId) {
  const [r] = await testDb.select().from(user).where(eq(user.id, id))
  return r!
}

const setLanguage = setMyLanguageFn as unknown as (args: {
  data: { language: string | null }
}) => Promise<{ chosen: string | null }>
const getLanguage = getMyLanguageFn as unknown as () => Promise<{
  chosen: string | null
  automatic: string
  automaticFromBrowser: boolean
}>

describe.skipIf(!fixture.available)('a person language (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    hoisted.acceptLanguage = 'fr-FR'
    hoisted.language = { mainLanguage: 'de', visitorLanguage: 'own' }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("saves a chosen language on the caller's own row, and clears it for Automatic", async () => {
    const me = await seedUser()
    const other = await seedUser()
    hoisted.userId = me
    await setLanguage({ data: { language: 'nl' } })
    expect((await row(me)).preferredLanguage).toBe('nl')
    expect((await row(other)).preferredLanguage).toBeNull()

    await setLanguage({ data: { language: null } })
    expect((await row(me)).preferredLanguage).toBeNull()
  })

  it('refuses a language the product does not have', async () => {
    hoisted.userId = await seedUser()
    await expect(setLanguage({ data: { language: 'ja' } })).rejects.toThrow()
    await expect(setLanguage({ data: { language: 'fr-FR' } })).rejects.toThrow()
  })

  it('reads the chosen language and what Automatic gives on this request', async () => {
    hoisted.userId = await seedUser()
    expect(await getLanguage()).toEqual({
      chosen: null,
      automatic: 'fr',
      automaticFromBrowser: true,
    })

    await setLanguage({ data: { language: 'pl' } })
    hoisted.acceptLanguage = 'ja'
    expect(await getLanguage()).toEqual({
      chosen: 'pl',
      automatic: 'de',
      automaticFromBrowser: false,
    })

    hoisted.language = { mainLanguage: 'de', visitorLanguage: 'main' }
    hoisted.acceptLanguage = 'fr'
    expect(await getLanguage()).toMatchObject({ automatic: 'de', automaticFromBrowser: false })
  })

  it('records the detected language at sign-in only when it changes', async () => {
    const id = await seedUser()
    const signIn = (acceptLanguage: string) =>
      handleDetectedLocaleCapture(
        { context: { newSession: { user: { id } } } },
        () => new Headers({ 'accept-language': acceptLanguage })
      )

    await signIn('uk-UA,uk;q=0.9')
    expect((await row(id)).detectedLocale).toBe('uk')

    const stamp = new Date('2020-01-01T00:00:00Z')
    await testDb.update(user).set({ detectedLocaleAt: stamp }).where(eq(user.id, id))
    await signIn('uk')
    expect((await row(id)).detectedLocaleAt?.toISOString()).toBe(stamp.toISOString())

    await signIn('ja-JP')
    expect((await row(id)).detectedLocale).toBe('uk')

    await signIn('es-MX')
    expect((await row(id)).detectedLocale).toBe('es')
  })

  it('records nothing for a request that is not a sign-in', async () => {
    const id = await seedUser()
    await handleDetectedLocaleCapture(
      { context: { newSession: null } },
      () => new Headers({ 'accept-language': 'de' })
    )
    await recordDetectedLocale(id, null)
    // An in-process sign-in, outside any request, records nothing and never throws.
    await handleDetectedLocaleCapture({ context: { newSession: { user: { id } } } }, () => {
      throw new Error('No StartEvent found in AsyncLocalStorage')
    })
    expect((await row(id)).detectedLocale).toBeNull()
  })
})
