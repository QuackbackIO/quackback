/**
 * The answers the runtime pauses read, against a real database, for every
 * paid feature a runtime path pauses or gates: a workspace on the Free plan
 * with each of them set up, in the four states the paths are tested in
 * (feature-states.ts mirrors these).
 *
 *  - flag off: nothing pauses; the plan gates answer as they always have.
 *  - grace: the grace features keep running; MCP stops at once.
 *  - enforced: every one of them pauses.
 *  - included: a plan with them all, nothing paused.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, integrations, principal, settings, user, webhooks, workflows } from '@/lib/server/db'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import type { PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import {
  getPlanLimits,
  invalidatePlanLimits,
  isFeatureLive,
  isFeaturePaused,
} from '../plan-limits.service'
import type { PlanFeatureKey } from '../plan-limits.features'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000
const NOW = '2026-11-01T00:00:00.000Z'

const GRACE_KEYS: PlanFeatureKey[] = [
  'webhooks',
  'workflows',
  'integrations',
  'customCss',
  'customDomain',
  'aiAssistant',
  'aiArticleTranslation',
]
const KEYS: PlanFeatureKey[] = [...GRACE_KEYS, 'mcpServer']

let settingsId: WorkspaceId

async function configure(planLimits: boolean, plan: PlanId) {
  await testDb
    .update(settings)
    .set({
      featureFlags: JSON.stringify({ feedback: true, planLimits }),
      tierLimits: null,
      cloud: storedCloud(plan) as never,
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
}

/** Every grace feature set up and running. */
async function setUpEverything() {
  const uid = createId('user') as UserId
  const ownerId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: uid, name: 'Acme Owner', email: `${uid}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: ownerId, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
  await testDb.insert(webhooks).values({
    url: 'https://example.com/hook',
    secret: 'acme-secret',
    events: ['post.created'],
    createdById: ownerId,
  } as never)
  await testDb.insert(workflows).values({
    name: 'Acme routing',
    class: 'background',
    triggerType: 'conversation.created',
    status: 'live',
  } as never)
  await testDb.insert(integrations).values({ integrationType: 'slack', status: 'active' })
  await testDb
    .update(settings)
    .set({
      customCss: '.acme { color: red }',
      widgetConfig: JSON.stringify({ messenger: { assistant: { respond: true } } }),
      helpCenterConfig: JSON.stringify({ autoTranslate: { enabled: true } }),
      cloudIdentity: {
        version: 1,
        displayName: 'Acme',
        canonicalOrigin: 'https://feedback.acme.test',
        platformHostname: 'acme.example.com',
        customDomains: [
          { hostname: 'feedback.acme.test', readiness: 'ready', isPrimary: true, updatedAt: NOW },
        ],
        updatedAt: NOW,
      } as never,
    })
    .where(eq(settings.id, settingsId))
}

async function answers() {
  const out: Record<string, { paused: boolean; live: boolean }> = {}
  for (const key of KEYS) {
    out[key] = { paused: await isFeaturePaused(key), live: await isFeatureLive(key) }
  }
  return out
}

function every(paused: boolean, live: boolean, overrides: Record<string, object> = {}) {
  return Object.fromEntries(KEYS.map((k) => [k, { paused, live, ...overrides[k] }]))
}

describe.skipIf(!fixture.available)('runtime pause answers on the Free plan (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    settingsId =
      row?.id ??
      (
        await testDb
          .insert(settings)
          .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
          .returning({ id: settings.id })
      )[0]!.id
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
    await setUpEverything()
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('flag off: nothing pauses and the plan gates answer as before', async () => {
    await configure(false, 'free')
    expect(await answers()).toEqual(every(false, false))
  })

  it('grace: the grace features keep running and MCP stops at once', async () => {
    await configure(true, 'free')
    expect((await getPlanLimits()).phase).toBe('grace')
    expect(await answers()).toEqual(
      every(false, true, { mcpServer: { paused: true, live: false } })
    )
  })

  it('enforced: every one of them pauses after the grace', async () => {
    await configure(true, 'free')
    await getPlanLimits()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect((await getPlanLimits()).phase).toBe('enforced')
    expect(await answers()).toEqual(every(true, false))
  })

  it('included: on a plan with them all, nothing pauses, with no setup again', async () => {
    await configure(true, 'free')
    await getPlanLimits()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect(await isFeaturePaused('webhooks')).toBe(true)
    await configure(true, 'enterprise')
    expect(await answers()).toEqual(every(false, true))
  })
})
