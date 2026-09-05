import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
const mocks = vi.hoisted(() => ({
  pooled: false,
  transaction: vi.fn(),
  handle: vi.fn(),
  deliveryId: vi.fn(),
  verify: vi.fn(),
  credentials: vi.fn(),
}))
vi.mock('@/lib/server/config', () => ({
  config: {
    get isPooledTenancy() {
      return mocks.pooled
    },
    integrationGatewayForwardSecret: 'gateway-secret',
  },
}))
vi.mock('@/lib/server/db', () => ({
  db: { transaction: mocks.transaction },
  integrationDeliveries: {},
}))
vi.mock('../index', () => ({
  getIntegration: () => ({
    appHooks: {
      kinds: ['events'],
      verify: mocks.verify,
      deliveryId: mocks.deliveryId,
      handle: mocks.handle,
    },
  }),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: mocks.credentials,
}))
import { handleAppHook } from '../app-hook-handler'
import { signGatewayForward, signGatewayReceipt } from '../gateway-forward'
import { verifySlackSignature } from '@/integrations/slack/server/verify'
const raw = JSON.stringify({ event_id: 'Ev1' })
const ts = '1788600000'
function request(gateway = true, provider = true, body = raw) {
  return new Request('https://tenant.example/api/integrations/slack/hooks/events', {
    method: 'POST',
    body,
    headers: {
      ...(gateway
        ? {
            'x-quackback-gateway-provider': 'slack',
            'x-quackback-gateway-received-at': ts,
            'x-quackback-gateway-receipt-signature': signGatewayReceipt(raw, ts, 'gateway-secret'),
            'x-quackback-gateway-timestamp': ts,
            'x-quackback-gateway-signature': signGatewayForward(raw, ts, 'gateway-secret'),
          }
        : {}),
      ...(provider
        ? {
            'x-slack-request-timestamp': ts,
            'x-slack-signature': `v0=${createHmac('sha256', 'slack-secret').update(`v0:${ts}:${raw}`).digest('hex')}`,
          }
        : {}),
    },
  })
}
let inserted: unknown[]
let tx: any
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(Number(ts) * 1000)
  mocks.pooled = false
  inserted = [{}]
  tx = {
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: async () => inserted }) }),
    }),
  }
  mocks.transaction.mockImplementation((fn) => fn(tx))
  mocks.credentials.mockResolvedValue({ signingSecret: 'slack-secret' })
  mocks.verify.mockImplementation(
    ({ headers, rawBody, credentials, verifiedAt }) =>
      verifySlackSignature(
        rawBody,
        headers.get('x-slack-request-timestamp'),
        headers.get('x-slack-signature'),
        credentials.signingSecret,
        verifiedAt
      ) === true
  )
  mocks.deliveryId.mockReturnValue('Ev1')
  mocks.handle.mockResolvedValue(new Response(null, { status: 200 }))
})
afterEach(() => vi.useRealTimers())
describe('app hook trust boundary', () => {
  it('requires gateway authentication only in pooled mode', async () => {
    expect((await handleAppHook(request(false), 'slack', 'events')).status).toBe(200)
    mocks.pooled = true
    expect((await handleAppHook(request(false), 'slack', 'events')).status).toBe(401)
    expect((await handleAppHook(request(), 'slack', 'events')).status).toBe(200)
  })
  it('always verifies the provider and rejects tampered bodies before enqueue', async () => {
    for (const pooled of [false, true]) {
      mocks.pooled = pooled
      expect((await handleAppHook(request(true, false), 'slack', 'events')).status).toBe(401)
      expect((await handleAppHook(request(true, true, raw + ' '), 'slack', 'events')).status).toBe(
        401
      )
    }
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('rejects expired forwards and provider timestamps', async () => {
    vi.setSystemTime((Number(ts) + 301) * 1000)
    expect((await handleAppHook(request(false), 'slack', 'events')).status).toBe(401)
    mocks.pooled = true
    expect((await handleAppHook(request(), 'slack', 'events')).status).toBe(401)
  })
  it('accepts a delayed forward only with an authentic original receipt and fresh envelope', async () => {
    mocks.pooled = true
    vi.setSystemTime((Number(ts) + 900) * 1000)
    const delayed = request()
    const fresh = String(Number(ts) + 900)
    delayed.headers.set('x-quackback-gateway-timestamp', fresh)
    delayed.headers.set(
      'x-quackback-gateway-signature',
      signGatewayForward(raw, fresh, 'gateway-secret')
    )
    expect((await handleAppHook(delayed.clone(), 'slack', 'events')).status).toBe(200)
    delayed.headers.set('x-quackback-gateway-received-at', fresh)
    expect((await handleAppHook(delayed, 'slack', 'events')).status).toBe(401)
    expect((await handleAppHook(request(false), 'slack', 'events')).status).toBe(401)
  })
  it('rejects receipts older than one hour even with a fresh forwarding signature', async () => {
    mocks.pooled = true
    vi.setSystemTime((Number(ts) + 3601) * 1000)
    const delayed = request()
    const fresh = String(Number(ts) + 3601)
    delayed.headers.set('x-quackback-gateway-timestamp', fresh)
    delayed.headers.set(
      'x-quackback-gateway-signature',
      signGatewayForward(raw, fresh, 'gateway-secret')
    )
    expect((await handleAppHook(delayed, 'slack', 'events')).status).toBe(401)
  })
  it('deduplicates before the handler and uses the receipt transaction for enqueue', async () => {
    expect((await handleAppHook(request(), 'slack', 'events')).status).toBe(200)
    expect(mocks.handle).toHaveBeenCalledWith('events', raw, 'text/plain;charset=UTF-8', tx)
    inserted = []
    expect((await handleAppHook(request(), 'slack', 'events')).status).toBe(200)
    expect(mocks.handle).toHaveBeenCalledTimes(1)
  })
  it('propagates handler failure out of the transaction so receipt insertion rolls back', async () => {
    mocks.handle.mockRejectedValue(new Error('enqueue unavailable'))
    expect((await handleAppHook(request(), 'slack', 'events')).status).toBe(503)
  })
  it('bounds the streamed body and rejects unsupported kinds', async () => {
    expect(
      (await handleAppHook(request(true, true, 'x'.repeat(1048577)), 'slack', 'events')).status
    ).toBe(413)
    expect((await handleAppHook(request(), 'slack', 'unknown')).status).toBe(404)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
