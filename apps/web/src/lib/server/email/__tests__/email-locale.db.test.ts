/**
 * The language of an email to a person, on a real database: their chosen
 * language first; then, for a customer only, the main language when the
 * workspace shows it to every visitor; then the browser of the request the
 * email answers; then the detected and sign-in provider languages; then the
 * main language. An address with no account gets the visitor rule.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusChangeEmail } from '@quackback/email'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

const hoisted = vi.hoisted(() => ({
  language: { mainLanguage: 'de', visitorLanguage: 'own' as 'own' | 'main' },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getLanguageConfig: async () => hoisted.language,
}))

import { emailLocaleFor, recipientLocale } from '../email-locale'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id, detected: user.detectedLocale }).from(user).limit(0)
  },
})

async function person(opts: {
  role?: 'user' | 'admin'
  chosen?: string | null
  detected?: string | null
  accountLocale?: string | null
}): Promise<{ principalId: PrincipalId; userId: UserId; email: string }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const email = `${userId}@example.com`
  await testDb.insert(user).values({
    id: userId,
    name: 'Sam',
    email,
    preferredLanguage: opts.chosen ?? null,
    detectedLocale: opts.detected ?? null,
    locale: opts.accountLocale ?? null,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role ?? 'user',
    type: 'user',
    displayName: 'Sam',
    createdAt: new Date(),
  })
  return { principalId, userId, email }
}

describe.skipIf(!fixture.available)('an email reader language (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    hoisted.language = { mainLanguage: 'de', visitorLanguage: 'own' }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("takes the person's chosen language first", async () => {
    const p = await person({ chosen: 'nl', detected: 'fr' })
    hoisted.language = { mainLanguage: 'de', visitorLanguage: 'main' }
    expect(await recipientLocale({ principalId: p.principalId }, { acceptLanguage: 'pl' })).toBe(
      'nl'
    )
  })

  it('gives a customer the main language for everyone, but never a teammate', async () => {
    hoisted.language = { mainLanguage: 'de', visitorLanguage: 'main' }
    const customer = await person({ detected: 'fr' })
    const teammate = await person({ role: 'admin', detected: 'fr' })
    expect(await recipientLocale({ principalId: customer.principalId })).toBe('de')
    expect(await recipientLocale({ principalId: teammate.principalId })).toBe('fr')
  })

  it("takes the request's browser before the detected language", async () => {
    const p = await person({ detected: 'fr' })
    expect(await recipientLocale({ userId: p.userId }, { acceptLanguage: 'es-ES' })).toBe('es')
    expect(await recipientLocale({ userId: p.userId })).toBe('fr')
  })

  it('takes the detected language, then the sign-in provider language, then the main language', async () => {
    const detected = await person({ detected: 'uk', accountLocale: 'pl-PL' })
    const provider = await person({ accountLocale: 'pl-PL' })
    const neither = await person({})
    expect(await recipientLocale({ principalId: detected.principalId })).toBe('uk')
    expect(await recipientLocale({ principalId: provider.principalId })).toBe('pl')
    expect(await recipientLocale({ principalId: neither.principalId })).toBe('de')
  })

  it('finds a person by address, and gives an address with no account the visitor rule', async () => {
    const p = await person({ chosen: 'th' })
    expect(await recipientLocale({ email: p.email.toUpperCase() })).toBe('th')
    expect(await recipientLocale({ email: 'nobody@example.com' })).toBe('de')
    hoisted.language = { mainLanguage: 'fr', visitorLanguage: 'main' }
    expect(await recipientLocale({ email: 'nobody@example.com' }, { acceptLanguage: 'es' })).toBe(
      'fr'
    )
  })

  it('writes the email in that language and keeps the words people wrote', async () => {
    const de = await emailLocaleFor('de')
    const html = renderToStaticMarkup(
      StatusChangeEmail({
        postTitle: 'Dark mode please',
        postUrl: 'https://acme.example/p/1',
        previousStatus: 'Open',
        newStatus: 'In Arbeit',
        organizationName: 'Acme',
        unsubscribeUrl: 'https://acme.example/u',
        isPostAuthor: true,
        i18n: de,
      })
    )
    expect(html).toContain('lang="de"')
    expect(html).toContain('Dein Feedback ist jetzt In Arbeit!')
    expect(html).toContain('Feedback ansehen')
    expect(html).toContain('Dark mode please')
    expect(html).not.toContain('View feedback')
  })
})
