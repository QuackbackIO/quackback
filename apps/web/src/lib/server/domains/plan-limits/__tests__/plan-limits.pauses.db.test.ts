/**
 * The answers the runtime pauses read, against a real database, for every
 * paid feature a runtime path pauses or gates: a workspace on the Free plan
 * with each of them set up, in the four states the paths are tested in
 * (feature-states.ts mirrors these). Each drop to Free starts from a plan
 * that had them all, as a lapse does.
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
import { DISABLED_CLOUD_CONFIG, type PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { resetConfig } from '@/lib/server/config'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import {
  detectPlanLimits,
  getPlanLimits,
  invalidatePlanLimits,
  isFeatureLive,
  isFeaturePaused,
} from '../plan-limits.service'
import { planFeatureSet, type PlanFeatureKey } from '../plan-limits.features'

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

/** An AI client and chat model, as on any server that runs the assistant and translation. */
function useAiModel() {
  vi.stubEnv('BASE_URL', 'https://feedback.acme.com')
  vi.stubEnv('SECRET_KEY', 'acme-test-secret-key-0123456789abcdef')
  vi.stubEnv('OPENAI_API_KEY', 'acme-key')
  vi.stubEnv('OPENAI_BASE_URL', 'https://ai.example.com/v1')
  vi.stubEnv('AI_CHAT_MODEL', 'acme-chat')
  resetConfig()
}

async function configure(planLimits: boolean, plan: PlanId) {
  await testDb
    .update(settings)
    .set({
      featureFlags: JSON.stringify({ feedback: true, supportInbox: true, planLimits }),
      tierLimits: null,
      cloud: storedCloud(plan) as never,
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
}

/** The drop to Free from a plan that had every paid feature. */
async function dropToFree() {
  await configure(true, 'free')
  await detectPlanLimits({
    previous: {
      plan: 'enterprise',
      features: planFeatureSet(OSS_TIER_LIMITS.features, DISABLED_CLOUD_CONFIG),
    },
  })
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
      widgetConfig: JSON.stringify({
        enabled: true,
        tabs: { messenger: true },
        messenger: { assistant: { respond: true } },
      }),
      helpCenterConfig: JSON.stringify({
        autoTranslate: { enabled: true },
        locales: { additional: ['fr'] },
      }),
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
    useAiModel()
    await setUpEverything()
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    resetConfig()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('flag off: nothing pauses and the plan gates answer as before', async () => {
    await configure(false, 'free')
    expect(await answers()).toEqual(every(false, false))
  })

  it('grace: the grace features keep running and MCP stops at once', async () => {
    await dropToFree()
    expect((await getPlanLimits()).phase).toBe('grace')
    expect(await answers()).toEqual(
      every(false, true, { mcpServer: { paused: true, live: false } })
    )
  })

  it('grace: setting up more is refused on the current plan, while what exists runs', async () => {
    await dropToFree()
    expect((await getPlanLimits()).phase).toBe('grace')
    expect(await isFeatureLive('webhooks')).toBe(true)
    expect(await isFeatureLive('workflows')).toBe(true)
    const { createWebhook } = await import('@/lib/server/domains/webhooks/webhook.service')
    const { createWorkflow } = await import('@/lib/server/domains/workflows/workflow.service')
    await expect(
      createWebhook(
        { url: 'https://example.com/hook2', events: ['post.created'] } as never,
        createId('principal') as PrincipalId
      )
    ).rejects.toMatchObject({ name: expect.stringMatching(/Entitlement|TierLimit/) })
    await expect(
      createWorkflow({
        name: 'Acme more',
        class: 'background',
        triggerType: 'conversation.created',
      } as never)
    ).rejects.toMatchObject({ name: expect.stringMatching(/Entitlement|TierLimit/) })
  })

  it('enforced: every one of them pauses after the grace', async () => {
    await dropToFree()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect((await getPlanLimits()).phase).toBe('enforced')
    expect(await answers()).toEqual(every(true, false))
  })

  it('included: on a plan with them all, nothing pauses, with no setup again', async () => {
    await dropToFree()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect(await isFeaturePaused('webhooks')).toBe(true)
    await configure(true, 'enterprise')
    expect(await answers()).toEqual(every(false, true))
  })

  it('pauses at the grace end exactly, not a moment before', async () => {
    await dropToFree()
    const { graceEndsAt } = await getPlanLimits()
    const end = Date.parse(graceEndsAt!)
    vi.useFakeTimers({ toFake: ['Date'], now: end - 1 })
    expect(await answers()).toEqual(
      every(false, true, { mcpServer: { paused: true, live: false } })
    )
    vi.setSystemTime(end)
    expect(await answers()).toEqual(every(true, false))
  })

  it('upgrade during the grace: nothing pauses at the old grace end', async () => {
    await dropToFree()
    await configure(true, 'enterprise')
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await answers()).toEqual(every(false, true))
  })

  it('an install without plan billing never pauses, with the flag on', async () => {
    await testDb
      .update(settings)
      .set({
        featureFlags: JSON.stringify({ feedback: true, planLimits: true }),
        tierLimits: null,
        cloud: null,
      })
      .where(eq(settings.id, settingsId))
    invalidateTierLimitsCache()
    await invalidateSettingsCache()
    await invalidatePlanLimits()
    expect((await getPlanLimits()).phase).toBe('ok')
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 30 * DAY })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await answers()).toEqual(every(false, true))
  })
})
