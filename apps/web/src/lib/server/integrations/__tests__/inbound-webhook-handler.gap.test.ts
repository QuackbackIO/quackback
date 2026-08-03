/**
 * Gap coverage for inbound-webhook-handler: the default single-integration path
 * (non-GitHub) — handleSingleIntegrationWebhook routing, verifySignature short
 * circuit, parseStatusChange null, and successful handlePostStatusUpdate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findFirstLink: vi.fn(),
  verifySignature: vi.fn(),
  parseStatusChange: vi.fn(),
  changeStatus: vi.fn(),
  decryptSecrets: vi.fn(),
  resolveStatusMapping: vi.fn(),
  eq: vi.fn((..._a: unknown[]) => ({})),
  and: vi.fn((..._a: unknown[]) => ({})),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      integrations: { findFirst: mocks.findFirst },
      postExternalLinks: { findFirst: mocks.findFirstLink },
    },
  },
  integrations: { integrationType: 'integrationType', status: 'status' },
  postExternalLinks: { integrationType: 'integrationType', externalId: 'externalId' },
  eq: mocks.eq,
  and: mocks.and,
}))

vi.mock('../index', () => ({
  getIntegration: vi.fn(() => ({
    inbound: {
      verifySignature: mocks.verifySignature,
      parseStatusChange: mocks.parseStatusChange,
    },
  })),
}))

vi.mock('../encryption', () => ({
  decryptSecrets: mocks.decryptSecrets,
}))

vi.mock('../status-mapping', () => ({
  resolveStatusMapping: mocks.resolveStatusMapping,
}))

vi.mock('@/lib/server/domains/posts/post.status', () => ({
  changeStatus: mocks.changeStatus,
}))

import { handleInboundWebhook } from '../inbound-webhook-handler'

function req(): Request {
  return new Request('https://app.example.com/api/integrations/linear/webhook', {
    method: 'POST',
    body: JSON.stringify({ data: 'x' }),
  })
}

function mockIntegration(configOverrides: Record<string, unknown> = {}) {
  mocks.findFirst.mockResolvedValue({
    id: 'integration_lin1',
    principalId: 'principal_bot1',
    integrationType: 'linear',
    status: 'active',
    secrets: null,
    config: {
      webhookSecret: 'linear-secret',
      statusMappings: { Done: 'status_done' },
      ...configOverrides,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.decryptSecrets.mockReturnValue({})
  mockIntegration()
  mocks.verifySignature.mockResolvedValue(true)
  mocks.parseStatusChange.mockResolvedValue({
    externalId: 'EXT-1',
    externalStatus: 'Done',
    eventType: 'issue.updated',
  })
  mocks.findFirstLink.mockResolvedValue({ postId: 'post_1' })
  mocks.resolveStatusMapping.mockReturnValue('status_done')
  mocks.changeStatus.mockResolvedValue({})
})

describe('handleInboundWebhook — default single-integration path', () => {
  it('returns 404 when no active integration is configured', async () => {
    mocks.findFirst.mockResolvedValue(undefined)
    const res = await handleInboundWebhook(req(), 'linear')
    expect(res.status).toBe(404)
  })

  it('returns 404 when the integration has no webhook secret', async () => {
    mockIntegration({ webhookSecret: undefined })
    const res = await handleInboundWebhook(req(), 'linear')
    expect(res.status).toBe(404)
    expect(mocks.verifySignature).not.toHaveBeenCalled()
  })

  it('short-circuits with the verifySignature response when verification fails', async () => {
    mocks.verifySignature.mockResolvedValue(new Response('Invalid signature', { status: 401 }))
    const res = await handleInboundWebhook(req(), 'linear')
    expect(res.status).toBe(401)
    expect(mocks.parseStatusChange).not.toHaveBeenCalled()
  })

  it('returns 200 without status change when parseStatusChange yields null', async () => {
    mocks.parseStatusChange.mockResolvedValue(null)
    const res = await handleInboundWebhook(req(), 'linear')
    expect(res.status).toBe(200)
    expect(mocks.changeStatus).not.toHaveBeenCalled()
  })

  it('applies the post status update on a verified, mapped status change', async () => {
    const res = await handleInboundWebhook(req(), 'linear')
    expect(res.status).toBe(200)
    expect(mocks.verifySignature).toHaveBeenCalled()
    expect(mocks.parseStatusChange).toHaveBeenCalled()
    expect(mocks.changeStatus).toHaveBeenCalledWith(
      'post_1',
      'status_done',
      expect.objectContaining({
        principalId: 'principal_bot1',
        displayName: 'linear Integration',
      })
    )
  })
})
