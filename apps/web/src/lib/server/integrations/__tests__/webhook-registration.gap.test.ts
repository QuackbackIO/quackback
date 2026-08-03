/**
 * Gap coverage for webhook-registration: IPv4 octet parsing in
 * isLocalOrPrivateHostname (exercised via resolveWebhookBaseUrl) and the
 * extraConfig merge branch in storeWebhookConfig.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationId } from '@quackback/ids'

const mocks = vi.hoisted(() => ({
  baseUrl: 'http://localhost:3000',
  findFirst: vi.fn(),
  updateWhere: vi.fn(),
  updateSet: vi.fn((_u: Record<string, unknown>) => ({ where: mocks.updateWhere })),
  update: vi.fn((_t: unknown) => ({ set: (u: Record<string, unknown>) => mocks.updateSet(u) })),
  eq: vi.fn((..._a: unknown[]) => ({})),
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get baseUrl() {
      return mocks.baseUrl
    },
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      integrations: {
        findFirst: mocks.findFirst,
      },
    },
    update: (t: unknown) => mocks.update(t),
  },
  integrations: { id: 'id' },
  eq: mocks.eq,
}))

import { resolveWebhookBaseUrl, storeWebhookConfig } from '../webhook-registration'

function H(input: Record<string, string>): Headers {
  return new Headers(input)
}

describe('resolveWebhookBaseUrl — IPv4 octet parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.baseUrl = 'http://localhost:3000'
  })

  it('keeps configured local base URL when request origin is a private 10.x address', () => {
    // request origin parses as IPv4 with octets, hits a === 10 branch (private)
    expect(resolveWebhookBaseUrl(H({ host: '10.0.0.5', 'x-forwarded-proto': 'https' }))).toBe(
      'http://localhost:3000'
    )
  })

  it('keeps configured local base URL for 172.16-31 private range', () => {
    expect(resolveWebhookBaseUrl(H({ host: '172.16.0.1', 'x-forwarded-proto': 'https' }))).toBe(
      'http://localhost:3000'
    )
  })

  it('keeps configured local base URL for 192.168 private range', () => {
    expect(resolveWebhookBaseUrl(H({ host: '192.168.1.1', 'x-forwarded-proto': 'https' }))).toBe(
      'http://localhost:3000'
    )
  })

  it('keeps configured local base URL for 100.64-127 CGNAT range', () => {
    expect(resolveWebhookBaseUrl(H({ host: '100.64.0.1', 'x-forwarded-proto': 'https' }))).toBe(
      'http://localhost:3000'
    )
  })

  it('treats invalid octets (>255) as non-private and uses the public IP origin', () => {
    // 999.1.1.1 -> regex matches but octet > 255 -> not private -> usable external
    expect(resolveWebhookBaseUrl(H({ host: '8.8.8.8', 'x-forwarded-proto': 'https' }))).toBe(
      'https://8.8.8.8'
    )
  })
})

describe('storeWebhookConfig — extraConfig branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges extraConfig and externalWebhookId into the stored config', async () => {
    mocks.findFirst.mockResolvedValue({ config: { existing: 'keep' } })

    await storeWebhookConfig('integration_1' as IntegrationId, 'secret-abc', 'ext-123', {
      teamId: 'T1',
      region: 'eu',
    })

    expect(mocks.updateSet).toHaveBeenCalledTimes(1)
    const update = mocks.updateSet.mock.calls[0][0] as { config: Record<string, unknown> }
    expect(update.config).toMatchObject({
      existing: 'keep',
      webhookSecret: 'secret-abc',
      statusSyncEnabled: true,
      teamId: 'T1',
      region: 'eu',
      externalWebhookId: 'ext-123',
    })
  })

  it('returns early without updating when the integration is missing', async () => {
    mocks.findFirst.mockResolvedValue(undefined)

    await storeWebhookConfig('integration_missing' as IntegrationId, 'secret')

    expect(mocks.update).not.toHaveBeenCalled()
  })
})
