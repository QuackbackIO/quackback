/**
 * When the published design cannot be rendered, the portal does not sit on the
 * legacy theme for the hour the settings are cached: the fallback is kept for
 * seconds, and the last view the same revision rendered to stands in for it.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, settings, user } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/local-cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/local-cache')>()),
  localCacheGet: () => undefined,
  localCacheSet: () => undefined,
}))

/** While set, rendering a design throws, as a renderer bug after an upgrade would. */
const fault = { on: false }
vi.mock('@/lib/server/domains/design/engine', async (original) => {
  const engine = await original<typeof import('@/lib/server/domains/design/engine')>()
  return {
    ...engine,
    portalDesignView: (source: Parameters<typeof engine.portalDesignView>[0]) => {
      if (fault.on) throw new Error('renderer broke')
      return engine.portalDesignView(source)
    },
  }
})

const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
const { invalidateSettingsCache } = await import('@/lib/server/domains/settings/settings.helpers')
const { publishDraft, saveDraft } = await import('../design.service')
const { defaultDesign } = await import('@/lib/shared/design/schema')
const { CACHE_KEYS } = await import('@/lib/server/cache')
const { resetConfig } = await import('@/lib/server/config')

const fixture = await createDbTestFixture()
let saved: NodeJS.ProcessEnv
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  saved = { ...process.env }
  Object.assign(process.env, { BASE_URL: 'https://portal.example.com', SECRET_KEY: 'x'.repeat(48) })
  resetConfig()
  fault.on = false
  await fixture.begin()
  await testDb.delete(settings)
})
afterEach(async () => {
  process.env = saved
  resetConfig()
  await fixture.rollback()
})
afterAll(fixture.close)

async function workspace() {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    featureFlags: JSON.stringify({ portalDesignV2: true }),
    brandingConfig: JSON.stringify({ themeMode: 'light', light: { primary: '#7a1f35' } }),
    setupState: JSON.stringify({ version: 2, steps: { core: true, workspace: true }, goals: [] }),
  })
}

async function publish(accent: string) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  const doc = defaultDesign()
  doc.brand.light.accent = accent
  const author = {
    principalId,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
  await saveDraft(doc, author)
  await publishDraft({ ...author, source: 'api' })
}

/** Seconds the cached settings have left to live, or null when none are cached. */
async function settingsSecondsLeft(): Promise<number | null> {
  const rows = getExecuteRows<{ left: number }>(
    await testDb.execute(sql`
      SELECT extract(epoch FROM expires_at - now())::float AS left
      FROM kv_store WHERE key = ${CACHE_KEYS.WORKSPACE_SETTINGS} AND expires_at > now()
    `)
  )
  return rows[0]?.left ?? null
}

describe('a design that cannot be rendered', () => {
  it('leaves a working read cached for the hour', async () => {
    await workspace()
    await publish('#0f766e')
    await invalidateSettingsCache()
    expect((await getWorkspaceSettings())?.portalDesign?.engine).toBe('v2')
    expect(await settingsSecondsLeft()).toBeGreaterThan(3000)
  })

  it('falls back to the legacy theme for 30 seconds at most when nothing rendered before', async () => {
    await workspace()
    fault.on = true
    expect((await getWorkspaceSettings())?.portalDesign).toBeUndefined()
    const left = await settingsSecondsLeft()
    expect(left).not.toBeNull()
    expect(left).toBeLessThanOrEqual(30)
  })

  it('serves the last view the published revision rendered to', async () => {
    await workspace()
    await publish('#0f766e')
    await invalidateSettingsCache()
    const good = (await getWorkspaceSettings())?.portalDesign
    expect(good).toMatchObject({ engine: 'v2' })

    fault.on = true
    await invalidateSettingsCache()
    const served = (await getWorkspaceSettings())?.portalDesign
    expect(served).toEqual(good)
    expect(served?.engine === 'v2' && served.themeStyles).toContain('--qb-accent: #0f766e;')
    expect(await settingsSecondsLeft()).toBeLessThanOrEqual(30)
  })

  it('does not serve a view another revision rendered to', async () => {
    await workspace()
    await publish('#0f766e')
    await invalidateSettingsCache()
    expect((await getWorkspaceSettings())?.portalDesign?.engine).toBe('v2')

    fault.on = true
    await publish('#b91c1c')
    await invalidateSettingsCache()
    expect((await getWorkspaceSettings())?.portalDesign).toBeUndefined()
  })
})
