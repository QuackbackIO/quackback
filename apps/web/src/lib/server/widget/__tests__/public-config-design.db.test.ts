/**
 * The widget launcher on a customer's own site takes its colours from the
 * same place the portal does. On the design engine that is the published
 * design, so publishing a new accent repaints the launcher; on the legacy
 * engine it stays the branding settings.
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

const { getPublicServerConfig } = await import('../public-config')
const { publishDraft, saveDraft } = await import('@/lib/server/domains/design/design.service')
const { defaultDesign } = await import('@/lib/shared/design/schema')
const { resetConfig } = await import('@/lib/server/config')

const fixture = await createDbTestFixture()
let saved: NodeJS.ProcessEnv
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  saved = { ...process.env }
  Object.assign(process.env, { BASE_URL: 'https://portal.example.com', SECRET_KEY: 'x'.repeat(48) })
  resetConfig()
  await fixture.begin()
  await testDb.delete(settings)
})
afterEach(async () => {
  process.env = saved
  resetConfig()
  await fixture.rollback()
})
afterAll(fixture.close)

/** A workspace whose legacy branding is maroon, so a design accent cannot be mistaken for it. */
async function workspace(flags: Record<string, boolean>) {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    featureFlags: JSON.stringify(flags),
    brandingConfig: JSON.stringify({
      themeMode: 'user',
      light: { primary: 'oklch(0.4 0.12 10)', radius: '0.75rem' },
    }),
    widgetConfig: JSON.stringify({ enabled: true }),
    setupState: JSON.stringify({ version: 2, steps: { core: true, workspace: true }, goals: [] }),
  })
}

async function publish(edit: (doc: ReturnType<typeof defaultDesign>) => void) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  const doc = defaultDesign()
  edit(doc)
  const author = {
    principalId,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
  await saveDraft(doc, author)
  await publishDraft({ ...author, source: 'api' })
}

describe('the launcher theme', () => {
  it('follows the published design on the design engine', async () => {
    await workspace({ portalDesignV2: true })
    await publish((doc) => {
      doc.mode = 'light'
      doc.brand.light.accent = '#0f766e'
      doc.shape.corners = 'pill'
    })
    const { config } = await getPublicServerConfig()
    expect(config.theme).toMatchObject({
      lightPrimary: '#0f766e',
      radius: '1rem',
      themeMode: 'light',
      revision: 1,
    })
    expect(config.theme?.lightPrimaryForeground).toMatch(/^#[0-9a-f]{6}$/)
    // A light-only design has no dark colours to send.
    expect(config.theme?.darkPrimary).toBeUndefined()
  })

  it('changes when a new accent is published', async () => {
    await workspace({ portalDesignV2: true })
    await publish((doc) => {
      doc.brand.light.accent = '#0f766e'
    })
    const before = (await getPublicServerConfig()).config.theme
    await publish((doc) => {
      doc.brand.light.accent = '#1d4ed8'
    })
    const after = (await getPublicServerConfig()).config.theme
    expect(before?.lightPrimary).toBe('#0f766e')
    expect(after?.lightPrimary).toBe('#1d4ed8')
    expect(after?.revision).toBe(2)
  })

  it('sends both modes for a design that follows the visitor', async () => {
    await workspace({ portalDesignV2: true })
    await publish((doc) => {
      doc.mode = 'auto'
    })
    const theme = (await getPublicServerConfig()).config.theme
    expect(theme?.themeMode).toBe('user')
    expect(theme?.lightPrimary).toMatch(/^#[0-9a-f]{6}$/)
    expect(theme?.darkPrimary).toMatch(/^#[0-9a-f]{6}$/)
    expect(theme?.darkPrimaryForeground).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('stays on the branding settings on the legacy engine', async () => {
    await workspace({})
    await publish((doc) => {
      doc.brand.light.accent = '#0f766e'
    })
    const theme = (await getPublicServerConfig()).config.theme
    expect(theme?.lightPrimary).not.toBe('#0f766e')
    expect(theme).toMatchObject({ radius: '0.75rem', themeMode: 'user' })
    expect(theme?.revision).toBeUndefined()
  })
})
