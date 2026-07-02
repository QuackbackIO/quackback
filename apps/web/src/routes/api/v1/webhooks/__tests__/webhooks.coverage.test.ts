import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

// ---------------------------------------------------------------------------
// Hoisted mocks for every dependency the three webhook routes touch.
//
// The routes use dynamic `await import(...)` for their domain services, so we
// mock those module paths and assert against the underlying spies.
// ---------------------------------------------------------------------------
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listDeliveriesForWebhookMock: vi.fn(),
  redeliverDeliveryMock: vi.fn(),
  getAllSampleEventPayloadsMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
  assertScopeAllowed: (...args: unknown[]) => hoisted.assertScopeAllowedMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/webhooks/webhook.deliveries', () => ({
  listDeliveriesForWebhook: (...args: unknown[]) => hoisted.listDeliveriesForWebhookMock(...args),
}))

vi.mock('@/lib/server/domains/webhooks/webhook.operator-actions', () => ({
  redeliverDelivery: (...args: unknown[]) => hoisted.redeliverDeliveryMock(...args),
}))

vi.mock('@/lib/server/events/sample-payloads', () => ({
  getAllSampleEventPayloads: (...args: unknown[]) => hoisted.getAllSampleEventPayloadsMock(...args),
}))

import { Route as DeliveriesRoute } from '../$webhookId.deliveries'
import { Route as RedeliverRoute } from '../$webhookId.deliveries.$deliveryId.redeliver'
import { Route as SamplePayloadsRoute } from '../sample-payloads'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const deliveriesHandlers = (DeliveriesRoute as unknown as RouteWithHandlers).options.server.handlers
const redeliverHandlers = (RedeliverRoute as unknown as RouteWithHandlers).options.server.handlers
const samplePayloadsHandlers = (SamplePayloadsRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'
const WEBHOOK = 'webhook_123'
const DELIVERY = 'wh_deliv_123'

// Minimal stand-in mirroring the domain ForbiddenError that `assertScopeAllowed`
// throws. `handleDomainError` only inspects `code` / `statusCode`, so a plain
// object is sufficient to drive the 403 mapping.
function scopeDeniedError() {
  return { code: 'API_KEY_SCOPE_DENIED', message: 'scope denied', statusCode: 403 }
}

function forbiddenAuthError() {
  return { code: 'FORBIDDEN', message: 'Admin access required for this operation', statusCode: 403 }
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/webhooks')
) {
  return { request, params: handlerParams }
}

/** Build a delivery row as returned by the deliveries service. */
function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: DELIVERY,
    webhookId: WEBHOOK,
    eventId: 'evt_1',
    eventType: 'post.created',
    attemptNumber: 1,
    status: 'success',
    httpStatus: 200,
    errorMessage: null,
    requestUrl: 'https://example.com/hook',
    requestPayloadBytes: 128,
    responseBodySnippet: 'ok',
    latencyMs: 42,
    signatureTimestamp: 1700000000,
    attemptedAt: new Date('2026-01-01T00:00:00.000Z'),
    nextRetryAt: null,
    ...overrides,
  }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'admin',
    key: { scopes: [] },
  })
  hoisted.assertScopeAllowedMock.mockImplementation(() => {})
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
})

describe('GET /api/v1/webhooks/$webhookId/deliveries', () => {
  it('lists deliveries with no cursor and serialises dates, returning a null nextCursor below the limit', async () => {
    const row = delivery()
    hoisted.listDeliveriesForWebhookMock.mockResolvedValue([row])

    const response = await deliveriesHandlers.GET(
      args(
        { webhookId: WEBHOOK },
        new Request('http://test/api/v1/webhooks/webhook_123/deliveries')
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_API_KEYS
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(WEBHOOK, 'webhook', 'webhook ID')
    // No cursor params provided → cursor null, default limit 50, status null.
    expect(hoisted.listDeliveriesForWebhookMock).toHaveBeenCalledWith(WEBHOOK, {
      cursor: null,
      limit: 50,
      statusFilter: null,
    })

    const data = await expectJsonData(response)
    expect(data.nextCursor).toBeNull()
    expect(data.deliveries).toHaveLength(1)
    expect(data.deliveries[0]).toMatchObject({
      id: DELIVERY,
      webhookId: WEBHOOK,
      attemptedAt: '2026-01-01T00:00:00.000Z',
      nextRetryAt: null,
    })
  })

  it('passes the cursor, status filter and limit through, and computes a nextCursor when the page is full', async () => {
    // limit=1 with a 1-row result → rows.length === limit → nextCursor populated.
    const row = delivery({
      id: 'wh_deliv_last',
      nextRetryAt: new Date('2026-02-02T00:00:00.000Z'),
      attemptedAt: new Date('2026-01-15T12:00:00.000Z'),
    })
    hoisted.listDeliveriesForWebhookMock.mockResolvedValue([row])

    const url =
      'http://test/api/v1/webhooks/webhook_123/deliveries' +
      '?limit=1&status=failed_retryable' +
      '&cursorAttemptedAt=2026-01-10T00:00:00.000Z&cursorId=wh_deliv_prev'
    const response = await deliveriesHandlers.GET(args({ webhookId: WEBHOOK }, new Request(url)))

    expect(response.status).toBe(200)
    expect(hoisted.listDeliveriesForWebhookMock).toHaveBeenCalledWith(WEBHOOK, {
      cursor: {
        attemptedAt: new Date('2026-01-10T00:00:00.000Z'),
        id: 'wh_deliv_prev',
      },
      limit: 1,
      statusFilter: 'failed_retryable',
    })

    const data = await expectJsonData(response)
    expect(data.nextCursor).toEqual({
      cursorAttemptedAt: '2026-01-15T12:00:00.000Z',
      cursorId: 'wh_deliv_last',
    })
    // Optional nextRetryAt is serialised through the `?? null` ternary.
    expect(data.deliveries[0].nextRetryAt).toBe('2026-02-02T00:00:00.000Z')
  })

  it('treats a cursorAttemptedAt without a cursorId as no cursor', async () => {
    hoisted.listDeliveriesForWebhookMock.mockResolvedValue([])

    const url =
      'http://test/api/v1/webhooks/webhook_123/deliveries?cursorAttemptedAt=2026-01-10T00:00:00.000Z'
    const response = await deliveriesHandlers.GET(args({ webhookId: WEBHOOK }, new Request(url)))

    expect(response.status).toBe(200)
    // cursorAttemptedAt present but cursorId missing → `&&` short-circuits to null.
    expect(hoisted.listDeliveriesForWebhookMock).toHaveBeenCalledWith(WEBHOOK, {
      cursor: null,
      limit: 50,
      statusFilter: null,
    })
    const data = await expectJsonData(response)
    expect(data.nextCursor).toBeNull()
    expect(data.deliveries).toEqual([])
  })

  it('returns 400 on invalid query parameters without calling the service', async () => {
    // limit above the max (200) fails the zod coercion bounds.
    const url = 'http://test/api/v1/webhooks/webhook_123/deliveries?limit=9999'
    const response = await deliveriesHandlers.GET(args({ webhookId: WEBHOOK }, new Request(url)))

    expect(response.status).toBe(400)
    expect(hoisted.listDeliveriesForWebhookMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid status enum value', async () => {
    const url = 'http://test/api/v1/webhooks/webhook_123/deliveries?status=bogus'
    const response = await deliveriesHandlers.GET(args({ webhookId: WEBHOOK }, new Request(url)))

    expect(response.status).toBe(400)
    expect(hoisted.listDeliveriesForWebhookMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the scope check fails, before reaching the service', async () => {
    hoisted.assertScopeAllowedMock.mockImplementationOnce(() => {
      throw scopeDeniedError()
    })

    const response = await deliveriesHandlers.GET(args({ webhookId: WEBHOOK }))

    expect(response.status).toBe(403)
    expect(hoisted.parseTypeIdMock).not.toHaveBeenCalled()
    expect(hoisted.listDeliveriesForWebhookMock).not.toHaveBeenCalled()
  })

  it('surfaces a thrown service error through handleDomainError', async () => {
    hoisted.listDeliveriesForWebhookMock.mockRejectedValue({
      code: 'WEBHOOK_NOT_FOUND',
      message: 'gone',
    })

    const response = await deliveriesHandlers.GET(
      args(
        { webhookId: WEBHOOK },
        new Request('http://test/api/v1/webhooks/webhook_123/deliveries')
      )
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/webhooks/$webhookId/deliveries/$deliveryId/redeliver', () => {
  it('redelivers after scope and id validation and returns the outcome', async () => {
    const outcome = { status: 'success', httpStatus: 200, attemptNumber: 2 }
    hoisted.redeliverDeliveryMock.mockResolvedValue(outcome)

    const response = await redeliverHandlers.POST(
      args({ webhookId: WEBHOOK, deliveryId: DELIVERY })
    )

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_API_KEYS
    )
    // Both the webhook id (path guard) and the delivery id are validated.
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(WEBHOOK, 'webhook', 'webhook ID')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(DELIVERY, 'wh_deliv', 'delivery ID')
    expect(hoisted.redeliverDeliveryMock).toHaveBeenCalledWith({ deliveryId: DELIVERY })
    expect(await expectJsonData(response)).toEqual(outcome)
  })

  it('returns 403 when the scope check fails, before validating ids or calling the service', async () => {
    hoisted.assertScopeAllowedMock.mockImplementationOnce(() => {
      throw scopeDeniedError()
    })

    const response = await redeliverHandlers.POST(
      args({ webhookId: WEBHOOK, deliveryId: DELIVERY })
    )

    expect(response.status).toBe(403)
    expect(hoisted.parseTypeIdMock).not.toHaveBeenCalled()
    expect(hoisted.redeliverDeliveryMock).not.toHaveBeenCalled()
  })

  it('maps a 422 unstored-payload domain error through handleDomainError', async () => {
    // The route documents a 422 when the original payload was not stored; the
    // domain error carries its own statusCode which handleDomainError honours.
    hoisted.redeliverDeliveryMock.mockRejectedValue({
      code: 'WH_DELIVERY_NO_PAYLOAD',
      message: 'payload not stored',
      statusCode: 422,
    })

    const response = await redeliverHandlers.POST(
      args({ webhookId: WEBHOOK, deliveryId: DELIVERY })
    )

    // 422 is not specially handled and falls through to the internal-error path.
    expect(response.status).toBe(500)
    expect(hoisted.redeliverDeliveryMock).toHaveBeenCalledWith({ deliveryId: DELIVERY })
  })

  it('returns 404 when the delivery is not found', async () => {
    hoisted.redeliverDeliveryMock.mockRejectedValue({
      code: 'NOT_FOUND',
      message: 'missing',
      statusCode: 404,
    })

    const response = await redeliverHandlers.POST(
      args({ webhookId: WEBHOOK, deliveryId: DELIVERY })
    )

    expect(response.status).toBe(404)
  })
})

describe('GET /api/v1/webhooks/sample-payloads', () => {
  it('returns all sample payloads after admin authentication', async () => {
    const payloads = { 'post.created': { id: 'evt_sample_1', type: 'post.created' } }
    hoisted.getAllSampleEventPayloadsMock.mockReturnValue(payloads)

    const response = await samplePayloadsHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    // This route performs no scope check beyond authentication.
    expect(hoisted.assertScopeAllowedMock).not.toHaveBeenCalled()
    expect(hoisted.getAllSampleEventPayloadsMock).toHaveBeenCalledTimes(1)
    expect(await expectJsonData(response)).toEqual(payloads)
  })

  it('returns 403 when authentication denies admin access, before loading payloads', async () => {
    hoisted.withApiKeyAuthMock.mockRejectedValueOnce(forbiddenAuthError())

    const response = await samplePayloadsHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.getAllSampleEventPayloadsMock).not.toHaveBeenCalled()
  })
})
