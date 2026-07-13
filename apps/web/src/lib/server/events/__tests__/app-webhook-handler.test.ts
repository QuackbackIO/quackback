import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  safeFetch: vi.fn(),
  claim: vi.fn(async () => true),
  release: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
  fail: vi.fn(async () => undefined),
  decrypt: vi.fn((..._args: unknown[]) => ({ secret: 'whsec_live' })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => h.rows) })),
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: (...args: unknown[]) => h.safeFetch(...args),
}))

vi.mock('../hook-idempotency', () => ({
  claimHookDelivery: () => h.claim(),
  releaseHookDelivery: () => h.release(),
  completeHookDelivery: () => h.complete(),
  failHookDelivery: () => h.fail(),
}))

vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: (...args: unknown[]) => h.decrypt(...args),
}))

import { appWebhookHook } from '../handlers/app-webhook'

const event = {
  id: 'evt_1',
  type: 'post.created',
  timestamp: '2026-01-01T00:00:00Z',
  actor: { type: 'user' },
  data: { post: { id: 'post_1' } },
} as never
const target = { url: 'https://queued.example/hook' }
const config = { appId: 'app_1' }

function deliverableRow(overrides: Record<string, unknown> = {}) {
  return {
    webhookSecretEnc: 'encrypted-secret',
    webhookEndpoint: 'https://current.example/hook',
    subscribedEventTypes: ['post.created'],
    grantedScopes: ['read:feedback'],
    appStatus: 'active',
    clientDisabled: false,
    ...overrides,
  }
}

describe('app webhook handler authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.rows = [deliverableRow()]
    h.claim.mockResolvedValue(true)
    h.safeFetch.mockResolvedValue({ ok: true, status: 200 } as Response)
  })

  it('revalidates authorization and uses the current endpoint at delivery time', async () => {
    await expect(appWebhookHook.run!(event, target, config)).resolves.toEqual({ success: true })

    expect(h.safeFetch).toHaveBeenCalledWith(
      'https://current.example/hook',
      expect.objectContaining({ method: 'POST' })
    )
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it.each([
    ['subscription', { subscribedEventTypes: [] }],
    ['scope', { grantedScopes: [] }],
    ['app status', { appStatus: 'disabled' }],
  ])('fails permanently when the current %s no longer authorizes delivery', async (_, change) => {
    h.rows = [deliverableRow(change)]

    await expect(appWebhookHook.run!(event, target, config)).resolves.toMatchObject({
      success: false,
      shouldRetry: false,
    })
    expect(h.safeFetch).not.toHaveBeenCalled()
    expect(h.fail).toHaveBeenCalledOnce()
  })

  it('fails permanently when the OAuth client no longer joins', async () => {
    h.rows = []

    await expect(appWebhookHook.run!(event, target, config)).resolves.toMatchObject({
      success: false,
      shouldRetry: false,
    })
    expect(h.safeFetch).not.toHaveBeenCalled()
    expect(h.fail).toHaveBeenCalledOnce()
  })
})
