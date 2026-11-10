/**
 * The website's logo and colour land in the design draft, saved against the
 * draft as it was read, so a change someone saves in the builder meanwhile
 * is never overwritten.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, settings, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => undefined,
}))

/** Runs once, right after the next read of the design: a colleague's save landing then. */
const meanwhile = vi.hoisted(() => ({ run: null as null | (() => Promise<unknown>) }))
vi.mock('../design.service', async (original) => {
  const real = await original<typeof import('../design.service')>()
  return {
    ...real,
    getDesignState: async () => {
      const state = await real.getDesignState()
      const run = meanwhile.run
      meanwhile.run = null
      if (run) await run()
      return state
    },
  }
})

const { websiteBrandingIntoDraft } = await import('../website-branding-draft')
const { getDesignState, publishDraft, saveDraft } = await import('../design.service')
const { defaultDesign } = await import('@/lib/shared/design/schema')

const { resetConfig } = await import('@/lib/server/config')

const fixture = await createDbTestFixture()
let env: NodeJS.ProcessEnv
beforeEach(async () => {
  env = { ...process.env }
  Object.assign(process.env, { BASE_URL: 'https://portal.example.com', SECRET_KEY: 'x'.repeat(48) })
  delete process.env.PORTAL_DESIGN_ENGINE
  resetConfig()
  expect(fixture.available).toBe(true)
  await fixture.begin()
  meanwhile.run = null
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    featureFlags: JSON.stringify({ portalDesignV2: true }),
  })
})
afterEach(async () => {
  process.env = env
  resetConfig()
  await fixture.rollback()
})
afterAll(fixture.close)

async function author() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
}

describe('websiteBrandingIntoDraft', () => {
  it('keeps a change saved in the builder while it was writing', async () => {
    const who = await author()
    await saveDraft(defaultDesign(), who)
    await publishDraft({ ...who, source: 'appearance' })
    const cards = defaultDesign()
    cards.layout.cards = 'list'
    meanwhile.run = () => saveDraft(cards, who)

    expect(
      await websiteBrandingIntoDraft(
        { logoKey: 'logos/2026/11/a-logo.png', colour: '#0f766e' },
        who
      )
    ).toBe(true)
    const draft = (await getDesignState())?.draft
    expect(draft?.layout.cards).toBe('list')
    expect(draft?.brand.logo.mark.light).toEqual({ key: 'logos/2026/11/a-logo.png' })
    expect(draft?.brand.light.accent).toBe('#0f766e')
  })
})
