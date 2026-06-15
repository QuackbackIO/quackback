import { beforeEach, describe, expect, it, vi } from 'vitest'

// The module logs failures via the structured logger (a child of @/lib/server/
// logger). Mock it so the child's `.error` is a spy we can assert on.
const { logSpies } = vi.hoisted(() => ({
  logSpies: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}))
vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...logSpies, child })
  return { logger: { ...logSpies, child }, createLogger: () => ({ ...logSpies, child }) }
})

import { segmentUserSync } from '../user-sync'

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
