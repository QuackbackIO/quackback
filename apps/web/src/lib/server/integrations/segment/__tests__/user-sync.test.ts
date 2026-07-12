import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

// The module logs failures via the structured logger (a child of @/lib/server/
// logger). Mock it so the child's `.error` is a spy we can assert on.
const { logSpies, redisSet } = vi.hoisted(() => ({
  logSpies: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
  redisSet: vi.fn().mockResolvedValue('OK'),
}))
vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...logSpies, child })
  return { logger: { ...logSpies, child }, createLogger: () => ({ ...logSpies, child }) }
})
vi.mock('@/lib/server/redis', () => ({ getRedis: () => ({ set: redisSet }) }))

import { segmentUserSync } from '../user-sync'

describe('segmentUserSync.handleIdentify', () => {
  const body = JSON.stringify({ type: 'identify', traits: { email: 'user@example.com' } })

  it('fails closed when no inbound secret is configured', async () => {
    const result = await segmentUserSync.handleIdentify?.(
      new Request('https://example.test'),
      body,
      {},
      {}
    )
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
  })

  it('accepts only a valid signature', async () => {
    const secret = 'segment-secret'
    const signature = createHmac('sha1', secret).update(body).digest('base64')
    const result = await segmentUserSync.handleIdentify?.(
      new Request('https://example.test', { headers: { 'x-signature': signature } }),
      body,
      {},
      { incomingSecret: secret }
    )
    expect(result).toMatchObject({ email: 'user@example.com' })
  })

  it('acknowledges a replayed Segment message without reprocessing it', async () => {
    const secret = 'segment-secret'
    const replayBody = JSON.stringify({
      type: 'identify',
      messageId: 'segment-message-1',
      traits: { email: 'user@example.com' },
    })
    redisSet.mockResolvedValueOnce(null)
    const signature = createHmac('sha1', secret).update(replayBody).digest('base64')

    const result = await segmentUserSync.handleIdentify?.(
      new Request('https://example.test', { headers: { 'x-signature': signature } }),
      replayBody,
      {},
      { incomingSecret: secret }
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(200)
  })

  it('rejects a tampered signature with 401 and never reaches the mutation path', async () => {
    redisSet.mockClear()
    const secret = 'segment-secret'
    // Correct HMAC, but flip the last byte so it decodes to a same-length,
    // wrong-content signature — must fail the timing-safe comparison.
    const validSignature = createHmac('sha1', secret).update(body).digest('base64')
    const tamperedSignature =
      validSignature.slice(0, -1) + (validSignature.endsWith('A') ? 'B' : 'A')

    const result = await segmentUserSync.handleIdentify?.(
      new Request('https://example.test', { headers: { 'x-signature': tamperedSignature } }),
      body,
      {},
      { incomingSecret: secret }
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
    // The signature check must fail before the messageId dedup claim (the
    // first write-adjacent side effect on the path to a mutation) is reached.
    expect(redisSet).not.toHaveBeenCalled()
  })

  it('rejects a missing x-signature header with 401 and never reaches the mutation path', async () => {
    redisSet.mockClear()
    const secret = 'segment-secret'

    const result = await segmentUserSync.handleIdentify?.(
      new Request('https://example.test'),
      body,
      {},
      { incomingSecret: secret }
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
    expect(redisSet).not.toHaveBeenCalled()
  })
})

describe('segmentUserSync.syncSegmentMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('throws and logs an error when Segment returns non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('invalid write key', { status: 401, statusText: 'Unauthorized' })
        )
    )

    await expect(
      segmentUserSync.syncSegmentMembership?.(
        [{ email: 'user@example.com' }],
        'Enterprise Users',
        true,
        { outgoingEnabled: true },
        { writeKey: 'bad-key' }
      )
    ).rejects.toThrow('Failed to sync 1/1 users')

    expect(logSpies.error).toHaveBeenCalledTimes(1)
  })

  it('completes without logging an error when Segment returns 2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })))

    await expect(
      segmentUserSync.syncSegmentMembership?.(
        [{ email: 'user@example.com' }],
        'Enterprise Users',
        false,
        { outgoingEnabled: true },
        { writeKey: 'valid-key' }
      )
    ).resolves.toBeUndefined()

    expect(logSpies.error).not.toHaveBeenCalled()
  })
})
