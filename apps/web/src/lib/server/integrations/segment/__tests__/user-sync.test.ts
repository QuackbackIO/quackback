import { beforeEach, describe, expect, it, vi } from 'vitest'
import { segmentUserSync } from '../user-sync'

describe('segmentUserSync.syncSegmentMembership', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when Segment returns non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('invalid write key', { status: 401, statusText: 'Unauthorized' })
        )
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      segmentUserSync.syncSegmentMembership?.(
        [{ email: 'user@example.com' }],
        'Enterprise Users',
        true,
        { outgoingEnabled: true },
        { writeKey: 'bad-key' }
      )
    ).rejects.toThrow('Failed to sync 1/1 users')

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]?.[0]).toContain('Failed to sync user user@example.com:')
  })

  it('completes when Segment returns 2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      segmentUserSync.syncSegmentMembership?.(
        [{ email: 'user@example.com' }],
        'Enterprise Users',
        false,
        { outgoingEnabled: true },
        { writeKey: 'valid-key' }
      )
    ).resolves.toBeUndefined()

    expect(errorSpy).not.toHaveBeenCalled()
  })
})
