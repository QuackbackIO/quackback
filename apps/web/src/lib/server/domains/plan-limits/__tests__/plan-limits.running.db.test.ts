/**
 * A workspace dropping to Free, end to end from the settings row: only a paid
 * feature that is running, and that the plan before included, is an issue.
 * A new workspace's defaults (assistant replies on, Support off) are not, nor
 * is the assistant on a Free workspace that never had it. An AI model is
 * configured throughout, as on any server that runs the assistant.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { sql } from '@/lib/server/db'

const cache = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) => (cache.has(key) ? structuredClone(cache.get(key)) : null),
  cacheSet: async (key: string, value: unknown) => {
    cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) cache.delete(key)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { getPlanLimits, invalidatePlanLimits, isFeatureLive } from '../plan-limits.service'
import { resetConfig } from '@/lib/server/config'
import { getWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import {
  DAY,
  addBoard,
  addOwner,
  clearCounted,
  configure,
  ensureSettings,
  freshDefaults,
  projection,
  setColumns,
  turnOn,
} from './plan-limits.db-seed'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

const EXPIRY = '2030-06-10T15:00:00.000Z'
const PAID = {
  customDomain: true,
  sso: true,
  webhooks: true,
  workflows: true,
  aiAssistant: true,
  aiArticleTranslation: true,
}

function useAiModel(on: boolean) {
  vi.stubEnv('BASE_URL', 'https://feedback.acme.com')
  vi.stubEnv('SECRET_KEY', 'acme-test-secret-key-0123456789abcdef')
  vi.stubEnv('OPENAI_API_KEY', on ? 'acme-key' : '')
  vi.stubEnv('OPENAI_BASE_URL', on ? 'https://ai.example.com/v1' : '')
  vi.stubEnv('AI_CHAT_MODEL', on ? 'acme-chat' : '')
  resetConfig()
}

async function lapse(at: number = Date.parse(EXPIRY)) {
  vi.setSystemTime(at)
  await invalidatePlanLimits()
  return getPlanLimits()
}

describe.skipIf(!fixture.available)('plan limits on what is running (real DB)', () => {
  let settingsId: WorkspaceId
  let ownerId: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2030-06-01T09:00:00.000Z') })
    cache.clear()
    useAiModel(true)
    settingsId = await ensureSettings()
    await clearCounted(settingsId)
    ownerId = await addOwner()
    await addBoard('Acme one', 0, new Date('2026-01-01T00:00:00.000Z'), ownerId)
    await configure(settingsId, {
      planLimits: true,
      tierLimits: null,
      cloud: { enabled: true, projection: projection(1, 'business', null, PAID, EXPIRY) },
    })
    await freshDefaults(settingsId)
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    resetConfig()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('keeps a new workspace with every default ok when its plan lapses to Free', async () => {
    // Assistant replies default on; Support (and so every chat surface) is off.
    expect((await getWidgetConfig()).messenger?.assistant?.respond).toBe(true)
    const lapsed = await lapse()
    expect(lapsed.plan).toBe('free')
    expect(lapsed.featureIssues).toEqual([])
    expect(lapsed.phase).toBe('ok')
  })

  it('pauses the assistant after the grace once Support puts it in front of visitors', async () => {
    await turnOn(settingsId, { supportInbox: true })
    const lapsed = await lapse()
    expect(lapsed.featureIssues).toEqual([{ key: 'aiAssistant', count: 1 }])
    expect(lapsed.phase).toBe('grace')
    expect(lapsed.since).toBe(EXPIRY)
    expect(await isFeatureLive('aiAssistant')).toBe(true)
    vi.setSystemTime(Date.parse(EXPIRY) + 8 * DAY)
    expect((await getPlanLimits()).phase).toBe('enforced')
    expect(await isFeatureLive('aiAssistant')).toBe(false)
  })

  it('does not count the assistant with replies paused or no model configured', async () => {
    await turnOn(settingsId, { supportInbox: true })
    useAiModel(false)
    expect((await lapse()).featureIssues).toEqual([])
    useAiModel(true)
    const widget = await getWidgetConfig('fresh')
    const assistant = { enabled: true, respond: false }
    await setColumns(settingsId, {
      widgetConfig: JSON.stringify({ ...widget, messenger: { ...widget.messenger, assistant } }),
    })
    expect((await lapse()).featureIssues).toEqual([])
  })

  it('gives a workspace that lapsed 30 days ago, found now, a fresh 7 days', async () => {
    await turnOn(settingsId, { supportInbox: true })
    const now = Date.parse(EXPIRY) + 30 * DAY
    const lapsed = await lapse(now)
    expect(lapsed.featureIssues).toEqual([{ key: 'aiAssistant', count: 1 }])
    expect(lapsed.phase).toBe('grace')
    expect(lapsed.since).toBe(new Date(now).toISOString())
    expect(Date.parse(lapsed.graceEndsAt!)).toBeGreaterThanOrEqual(now + 7 * DAY)
    expect(lapsed.fromPlan).toBe('business')
  })
})

describe.skipIf(!fixture.available)(
  'plan limits on a Free workspace that never paid (real DB)',
  () => {
    let settingsId: WorkspaceId
    let ownerId: PrincipalId

    beforeEach(async () => {
      await fixture.begin()
      await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
      cache.clear()
      useAiModel(true)
      settingsId = await ensureSettings()
      await clearCounted(settingsId)
      ownerId = await addOwner()
      await addBoard('Acme one', 0, new Date('2026-01-01T00:00:00.000Z'), ownerId)
      await configure(settingsId, {
        planLimits: true,
        tierLimits: null,
        cloud: { enabled: true, projection: projection(1, 'free', 1, {}) },
      })
      await freshDefaults(settingsId)
      await turnOn(settingsId, { supportInbox: true })
      await invalidatePlanLimits()
    })
    afterEach(async () => {
      vi.unstubAllEnvs()
      resetConfig()
      await invalidatePlanLimits()
      await fixture.rollback()
    })

    it('raises no assistant issue when it turns Support on', async () => {
      const limits = await getPlanLimits()
      expect(limits.featureIssues).toEqual([])
      expect(limits.phase).toBe('ok')
    })

    it('still judges its caps, and carries nothing it never had into the grace', async () => {
      await addBoard('Acme two', 0, new Date('2026-02-01T00:00:00.000Z'), ownerId)
      await invalidatePlanLimits()
      const limits = await getPlanLimits()
      expect(limits.issues.map((issue) => issue.key)).toEqual(['maxBoards'])
      expect(limits.featureIssues).toEqual([])
      expect(limits.phase).toBe('grace')
      expect(limits.fromFeatures?.aiAssistant).toBe(false)
    })
  }
)
