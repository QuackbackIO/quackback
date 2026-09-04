/**
 * The plan gate on webhook creation, driven through the real service entry
 * point so the test proves the gate is ON the path rather than proving
 * `requireEntitlement` works in isolation:
 *
 *   createWebhook -> requireEntitlement -> getCloudConfig
 *     -> getWorkspaceSettings -> resolveCloudConfig -> refuse or insert
 *
 * Both directions are asserted for every fixture. A one-directional test cannot
 * tell a real gate from an always-refuse or an always-allow, and the cloud-off
 * fixture is asserted per seam because `isEntitled()` grants everything when
 * cloud is absent: a fixture that forgot to enable cloud would pass against
 * unwired code.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'
import type { PrincipalId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  mockGetWorkspaceSettings: vi.fn(),
  mockInsert: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({ from: () => Promise.resolve([{ count: 0 }]) }),
    insert: (...args: unknown[]) => hoisted.mockInsert(...args),
  },
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { ACTIVE_WEBHOOKS: 'hooks:webhooks-active:v2' },
}))

vi.mock('@/lib/server/events/integrations/webhook/constants', () => ({
  isValidWebhookUrl: () => true,
}))

vi.mock('../encryption', () => ({
  encryptWebhookSecret: vi.fn(() => 'enc'),
}))

import { createWebhook } from '../webhook.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

const INPUT = { url: 'https://example.com/hook', events: ['post.created'] }
const CREATOR = 'prn_x' as PrincipalId

function withCloud(cloud: unknown): void {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  vi.clearAllMocks()
  // The operator-cap layer is wide open in every case here, so the entitlement
  // is the only thing that can refuse. Without this the tier gate would refuse
  // first and the test could not see the entitlement at all.
  vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
  hoisted.mockInsert.mockReturnValue({
    values: () => ({
      returning: () =>
        Promise.resolve([
          {
            id: 'webhook_1',
            url: INPUT.url,
            events: INPUT.events,
            boardIds: null,
            status: 'active',
            failureCount: 0,
            lastError: null,
            lastTriggeredAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdById: CREATOR,
          },
        ]),
    }),
  })
})

describe('createWebhook — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('creates the webhook with %s', async (_label, cloud) => {
    withCloud(cloud)
    await expect(createWebhook(INPUT, CREATOR)).resolves.toMatchObject({
      webhook: { url: INPUT.url },
    })
    expect(hoisted.mockInsert).toHaveBeenCalledOnce()
  })
})

describe('createWebhook — plan gate', () => {
  it('refuses on a plan without the entitlement and names the plan that has it', async () => {
    withCloud(storedCloud('free'))

    const refusal = await createWebhook(INPUT, CREATOR).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const error = refusal as EntitlementRequiredError
    expect(error.entitlement).toBe('webhooks')
    expect(error.requiredPlanName).toBe('Pro')
    expect(error.statusCode).toBe(402)
    expect(error.message).toBe(
      'Webhooks are a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.'
    )
    // Nothing was written.
    expect(hoisted.mockInsert).not.toHaveBeenCalled()
  })

  it('creates the webhook on a plan that includes it', async () => {
    withCloud(storedCloud('growth'))
    await expect(createWebhook(INPUT, CREATOR)).resolves.toMatchObject({
      webhook: { url: INPUT.url },
    })
    expect(hoisted.mockInsert).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud(storedCloud('free', { webhooks: true }))
    await expect(createWebhook(INPUT, CREATOR)).resolves.toBeDefined()

    withCloud(storedCloud('enterprise', { webhooks: false }))
    await expect(createWebhook(INPUT, CREATOR)).rejects.toBeInstanceOf(EntitlementRequiredError)
  })
})
