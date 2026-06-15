import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
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

describe('saveNtfyFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
    hoisted.mockSaveIntegration.mockResolvedValue('integration_1')
    hoisted.mockSafeFetch.mockResolvedValue({ ok: true, status: 200 })
  })

  it('persists config.channelId = url so the resolver can find it', async () => {
    const url = 'https://ntfy.sh/my-topic'
    await handlers[0]({ data: { url } })

    expect(hoisted.mockSaveIntegration).toHaveBeenCalledWith(
      'ntfy',
      expect.objectContaining({
        config: expect.objectContaining({ channelId: url }),
      })
    )
  })

  it('stores empty string accessToken when no token provided', async () => {
    await handlers[0]({ data: { url: 'https://ntfy.sh/my-topic' } })

    expect(hoisted.mockSaveIntegration).toHaveBeenCalledWith(
      'ntfy',
      expect.objectContaining({ accessToken: '' })
    )
  })

  it('stores the token as accessToken when provided', async () => {
    await handlers[0]({ data: { url: 'https://ntfy.sh/my-topic', token: 'tk_secret' } })

    expect(hoisted.mockSaveIntegration).toHaveBeenCalledWith(
      'ntfy',
      expect.objectContaining({ accessToken: 'tk_secret' })
    )
  })

  it('includes Authorization header in test-publish when token provided', async () => {
    await handlers[0]({ data: { url: 'https://ntfy.sh/my-topic', token: 'tk_secret' } })

    const fetchCall = hoisted.mockSafeFetch.mock.calls[0]
    expect(fetchCall[1].headers['Authorization']).toBe('Bearer tk_secret')
  })

  it('does NOT include Authorization header in test-publish when no token', async () => {
    await handlers[0]({ data: { url: 'https://ntfy.sh/my-topic' } })

    const fetchCall = hoisted.mockSafeFetch.mock.calls[0]
    expect(fetchCall[1].headers['Authorization']).toBeUndefined()
  })

  it('rejects an invalid topic URL before publishing or saving', async () => {
    await expect(handlers[0]({ data: { url: 'https://ntfy.sh/a/b' } })).rejects.toThrow(
      /valid ntfy topic URL/
    )
    expect(hoisted.mockSafeFetch).not.toHaveBeenCalled()
    expect(hoisted.mockSaveIntegration).not.toHaveBeenCalled()
  })
})
