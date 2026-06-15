import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSaveIntegration: vi.fn(),
  mockSafeFetch: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))
vi.mock('@/lib/server/integrations/save', () => ({
  saveIntegration: hoisted.mockSaveIntegration,
}))
vi.mock('@/lib/server/content/ssrf-guard', () => ({
  safeFetch: hoisted.mockSafeFetch,
}))

await import('../functions')

describe('saveN8nWebhookFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
    hoisted.mockSaveIntegration.mockResolvedValue('integration_1')
    hoisted.mockSafeFetch.mockResolvedValue({ ok: true, status: 200 })
  })

  it('persists the webhook URL as config.channelId so the resolver can find it', async () => {
    const webhookUrl = 'https://n8n.example.com/webhook/abc'
    await handlers[0]({ data: { webhookUrl } })

    expect(hoisted.mockSaveIntegration).toHaveBeenCalledWith(
      'n8n',
      expect.objectContaining({
        config: expect.objectContaining({ channelId: webhookUrl }),
      })
    )
  })
})
