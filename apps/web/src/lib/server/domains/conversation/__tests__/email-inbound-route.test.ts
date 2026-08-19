/**
 * One address, two transports, and the wiring that tells them apart.
 *
 * The provider webhook path predates the edge mail bridge and is unchanged by
 * it, which is a claim about this dispatch and nothing else: if raw MIME ever
 * reached the webhook handler it would be refused for having no provider
 * signature, and if a provider event ever reached the raw-MIME handler it would
 * be refused for having no transport signature. Both would be silent mail loss
 * caused by a one-line routing mistake, so the routing has its own test.
 *
 * The discriminator itself is real here; only the two handlers are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handleCloudflareInboundEmail = vi.fn()
const handleInboundEmailWebhook = vi.fn()

vi.mock('@/lib/server/domains/conversation/email-cloudflare-handler', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/conversation/email-cloudflare-handler')
  >()),
  handleCloudflareInboundEmail: (...a: unknown[]) => handleCloudflareInboundEmail(...a),
}))
vi.mock('@/lib/server/domains/conversation/email-webhook-handler', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/conversation/email-webhook-handler')
  >()),
  handleInboundEmailWebhook: (...a: unknown[]) => handleInboundEmailWebhook(...a),
}))

import { Route } from '@/routes/api/chat/email/inbound'

// `handlers` is typed as either a map or a factory returning one; this route
// declares the map, so it is narrowed here rather than at every call.
const post = (
  Route.options.server as unknown as {
    handlers: { POST: (ctx: { request: Request }) => Promise<Response> }
  }
).handlers.POST

function request(contentType: string, body: string): Request {
  return new Request('http://ws-t1.example.com/api/chat/email/inbound', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  handleCloudflareInboundEmail.mockResolvedValue(new Response('', { status: 200 }))
  handleInboundEmailWebhook.mockResolvedValue(new Response('', { status: 200 }))
})

describe('POST /api/chat/email/inbound', () => {
  it('hands raw MIME to the transport that signs raw MIME', async () => {
    await post({ request: request('message/rfc822', 'From: a@b.test\r\n\r\nhi') })

    expect(handleCloudflareInboundEmail).toHaveBeenCalledOnce()
    expect(handleInboundEmailWebhook).not.toHaveBeenCalled()
  })

  it('leaves a provider webhook event on the path it has always taken', async () => {
    await post({ request: request('application/json', '{"type":"email.received"}') })

    expect(handleInboundEmailWebhook).toHaveBeenCalledOnce()
    expect(handleCloudflareInboundEmail).not.toHaveBeenCalled()
  })
})
