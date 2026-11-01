/**
 * The workspace settings carry the design portal pages render with. With the
 * flag off they carry nothing and the pages keep today's theme; with it on
 * they carry the published design, or one converted from the branding
 * settings, and the override puts every workspace back on legacy.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, settings, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// A hit would let one case answer another's question.
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/local-cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/local-cache')>()),
  localCacheGet: () => undefined,
  localCacheSet: () => undefined,
}))

const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
const { publishDraft, saveDraft } = await import('../design.service')
const { defaultDesign } = await import('@/lib/shared/design/schema')
const { config, resetConfig } = await import('@/lib/server/config')

const fixture = await createDbTestFixture()
let saved: NodeJS.ProcessEnv
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  // Config loads in full on first read; DATABASE_URL already points at the test database.
  saved = { ...process.env }
  Object.assign(process.env, { BASE_URL: 'https://portal.example.com', SECRET_KEY: 'x'.repeat(48) })
  resetConfig()
  await fixture.begin()
  // Only this case's workspace, so the read cannot pick up another.
  await testDb.delete(settings)
})
afterEach(async () => {
  process.env = saved
  resetConfig()
  await fixture.rollback()
})
afterAll(fixture.close)

async function workspace(flags: Record<string, boolean>, customCss = '') {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    featureFlags: JSON.stringify(flags),
    brandingConfig: JSON.stringify({ themeMode: 'light', light: { primary: '#7a1f35' } }),
    customCss,
    setupState: JSON.stringify({ version: 2, steps: { core: true, workspace: true }, goals: [] }),
  })
}

async function publishTeal() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  const doc = defaultDesign()
  doc.brand.light.accent = '#0f766e'
  const author = {
    principalId,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
  await saveDraft(doc, author)
  await publishDraft({ ...author, source: 'api' })
}

describe('the design the settings carry', () => {
  it('is absent while the flag is off, even with a published design', async () => {
    await workspace({})
    await publishTeal()
    expect((await getWorkspaceSettings())?.portalDesign).toBeUndefined()
  })

  it('is the published design when the flag is on', async () => {
    await workspace({ portalDesignV2: true })
    await publishTeal()
    const view = (await getWorkspaceSettings())?.portalDesign
    expect(view).toMatchObject({ engine: 'v2', revision: 1 })
    expect(view?.engine === 'v2' && view.themeStyles).toContain('--qb-accent: #0f766e;')
  })

  it('is converted from the branding settings when nothing is published', async () => {
    await workspace({ portalDesignV2: true })
    const view = (await getWorkspaceSettings())?.portalDesign
    expect(view).toMatchObject({ engine: 'v2', mode: 'light', revision: null })
    expect(view?.engine === 'v2' && view.themeStyles).toContain('--qb-accent: #7a1f35;')
  })

  it('is absent for a workspace with custom CSS and nothing published', async () => {
    await workspace({ portalDesignV2: true }, '.post-card { color: red }')
    expect((await getWorkspaceSettings())?.portalDesign).toBeUndefined()
  })

  it('is absent everywhere when the override keeps legacy', async () => {
    process.env.PORTAL_DESIGN_ENGINE = 'legacy'
    resetConfig()
    expect(config.portalDesignEngine).toBe('legacy')
    await workspace({ portalDesignV2: true })
    await publishTeal()
    expect((await getWorkspaceSettings())?.portalDesign).toBeUndefined()
  })
})
