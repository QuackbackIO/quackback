/**
 * operator-actions — fireTestEvent + redeliverDelivery. Both bypass BullMQ
 * and call `webhookHook.run` synchronously. Mocks the hook + service +
 * deliveries reads + secret decryption.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runMock = vi.fn()
const getWebhookByIdMock = vi.fn()
const getDeliveryMock = vi.fn()
const decryptSecretMock = vi.fn()

vi.mock('../../../events/handlers/webhook', () => ({
  webhookHook: { run: runMock },
}))

vi.mock('../webhook.service', () => ({
  getWebhookById: getWebhookByIdMock,
}))

vi.mock('../webhook.deliveries', () => ({
  getDelivery: getDeliveryMock,
}))

vi.mock('../encryption', () => ({
  decryptWebhookSecret: decryptSecretMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
  decryptSecretMock.mockReturnValue('whsec_decoded')
})

const ACTIVE_WEBHOOK = {
  id: 'webhook_1',
  url: 'https://example.com/hook',
  secret: 'enc:secret',
  status: 'active' as const,
  events: ['post.created', 'ticket.created'],
  deletedAt: null,
}

describe('fireTestEvent', () => {
  it('runs the webhook handler with a sample payload + test-fire eventId', async () => {
    getWebhookByIdMock.mockResolvedValue(ACTIVE_WEBHOOK)
    runMock.mockResolvedValue({ success: true })
    const { fireTestEvent } = await import('../webhook.operator-actions')
    const result = await fireTestEvent({
      webhookId: 'webhook_1' as never,
      eventType: 'post.created',
    })

    expect(result.success).toBe(true)
    expect(result.eventId.startsWith('evt_test_')).toBe(true)
    expect(runMock).toHaveBeenCalledOnce()
    const [event, cfg, ctx] = runMock.mock.calls[0]
    expect(event.type).toBe('post.created')
    expect(event.id).toBe(result.eventId)
    expect(cfg).toEqual({ url: ACTIVE_WEBHOOK.url })
    expect(ctx).toEqual({
      secret: 'whsec_decoded',
      webhookId: 'webhook_1',
      attemptNumber: 0,
    })
  })

  it('rejects unknown event types with WEBHOOK_TEST_BAD_EVENT', async () => {
    const { fireTestEvent } = await import('../webhook.operator-actions')
    await expect(
      fireTestEvent({ webhookId: 'webhook_1' as never, eventType: 'bogus.event' })
    ).rejects.toMatchObject({ code: 'WEBHOOK_TEST_BAD_EVENT' })
    expect(runMock).not.toHaveBeenCalled()
  })

  it('rejects when webhook is disabled with WEBHOOK_INACTIVE', async () => {
    getWebhookByIdMock.mockResolvedValue({ ...ACTIVE_WEBHOOK, status: 'disabled' })
    const { fireTestEvent } = await import('../webhook.operator-actions')
    await expect(
      fireTestEvent({ webhookId: 'webhook_1' as never, eventType: 'post.created' })
    ).rejects.toMatchObject({ code: 'WEBHOOK_INACTIVE' })
    expect(runMock).not.toHaveBeenCalled()
  })

  it('rejects when webhook does not subscribe to the event', async () => {
    getWebhookByIdMock.mockResolvedValue({
      ...ACTIVE_WEBHOOK,
      events: ['comment.created'],
    })
    const { fireTestEvent } = await import('../webhook.operator-actions')
    await expect(
      fireTestEvent({ webhookId: 'webhook_1' as never, eventType: 'post.created' })
    ).rejects.toMatchObject({ code: 'WEBHOOK_NOT_SUBSCRIBED' })
    expect(runMock).not.toHaveBeenCalled()
  })

  it('reports handler failure outcome instead of throwing', async () => {
    getWebhookByIdMock.mockResolvedValue(ACTIVE_WEBHOOK)
    runMock.mockResolvedValue({ success: false, error: 'connect timeout' })
    const { fireTestEvent } = await import('../webhook.operator-actions')
    const result = await fireTestEvent({
      webhookId: 'webhook_1' as never,
      eventType: 'post.created',
    })
    expect(result).toMatchObject({ success: false, errorMessage: 'connect timeout' })
  })
})

describe('redeliverDelivery', () => {
  const STORED_PAYLOAD = {
    id: 'evt_real_123',
    type: 'post.created',
    createdAt: '2026-01-02T00:00:00.000Z',
    data: { post: { id: 'post_1' } },
  }

  it('replays with attemptNumber + 1 using the stored payload', async () => {
    getDeliveryMock.mockResolvedValue({
      id: 'wh_deliv_1',
      webhookId: 'webhook_1',
      attemptNumber: 2,
      requestPayloadJson: STORED_PAYLOAD,
      requestPayloadTruncated: false,
    })
    getWebhookByIdMock.mockResolvedValue(ACTIVE_WEBHOOK)
    runMock.mockResolvedValue({ success: true })

    const { redeliverDelivery } = await import('../webhook.operator-actions')
    const result = await redeliverDelivery({ deliveryId: 'wh_deliv_1' as never })

    expect(result).toMatchObject({ success: true, eventId: 'evt_real_123' })
    expect(runMock).toHaveBeenCalledOnce()
    const [event, cfg, ctx] = runMock.mock.calls[0]
    expect(event.id).toBe('evt_real_123')
    expect(event.type).toBe('post.created')
    expect(event.timestamp).toBe('2026-01-02T00:00:00.000Z')
    expect(cfg).toEqual({ url: ACTIVE_WEBHOOK.url })
    expect(ctx).toEqual({
      secret: 'whsec_decoded',
      webhookId: 'webhook_1',
      attemptNumber: 3,
    })
  })

  it('rejects with DELIVERY_NO_PAYLOAD when payload was never stored', async () => {
    getDeliveryMock.mockResolvedValue({
      id: 'wh_deliv_1',
      webhookId: 'webhook_1',
      attemptNumber: 1,
      requestPayloadJson: null,
      requestPayloadTruncated: false,
    })
    const { redeliverDelivery } = await import('../webhook.operator-actions')
    await expect(redeliverDelivery({ deliveryId: 'wh_deliv_1' as never })).rejects.toMatchObject({
      code: 'DELIVERY_NO_PAYLOAD',
    })
    expect(runMock).not.toHaveBeenCalled()
  })

  it('rejects with DELIVERY_NO_PAYLOAD when payload was truncated', async () => {
    getDeliveryMock.mockResolvedValue({
      id: 'wh_deliv_1',
      webhookId: 'webhook_1',
      attemptNumber: 1,
      requestPayloadJson: null,
      requestPayloadTruncated: true,
    })
    const { redeliverDelivery } = await import('../webhook.operator-actions')
    await expect(redeliverDelivery({ deliveryId: 'wh_deliv_1' as never })).rejects.toMatchObject({
      code: 'DELIVERY_NO_PAYLOAD',
    })
  })

  it('rejects with DELIVERY_NOT_FOUND when delivery is missing', async () => {
    getDeliveryMock.mockResolvedValue(null)
    const { redeliverDelivery } = await import('../webhook.operator-actions')
    await expect(
      redeliverDelivery({ deliveryId: 'wh_deliv_missing' as never })
    ).rejects.toMatchObject({ code: 'DELIVERY_NOT_FOUND' })
  })
})
