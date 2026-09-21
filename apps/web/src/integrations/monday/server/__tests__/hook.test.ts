import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PostCreatedEvent } from '@/lib/server/events/types'
import { withSyncTransport } from '@/lib/server/integrations/sync/transport'
import { mondayHook } from '../hook'

const event: PostCreatedEvent = {
  id: 'event-monday',
  type: 'post.created',
  timestamp: new Date().toISOString(),
  actor: { type: 'service' },
  data: {
    post: {
      id: 'post-monday',
      title: 'Search feedback',
      content: 'Include archived items',
      boardId: 'board-monday',
      boardSlug: 'feedback',
      voteCount: 0,
    },
  },
}
afterEach(() => vi.restoreAllMocks())

describe('Monday compound delivery', () => {
  it.each([
    ['HTTP rejection', () => new Response(null, { status: 429 })],
    ['GraphQL rejection', () => Response.json({ errors: [{ message: 'Rate limited' }] })],
    ['missing update result', () => Response.json({ data: {} })],
  ] as const)('does not accept partial success after a follow-up %s', async (_name, rejection) => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ data: { create_item: { id: '123' } } }))
      .mockResolvedValueOnce(rejection())
    const outcome = await withSyncTransport(() =>
      mondayHook.run(
        event,
        { channelId: '456' },
        {
          accessToken: 'test-token',
          rootUrl: 'https://workspace.test',
        }
      )
    )
    expect(outcome).toEqual({ state: 'uncertain', errorCode: 'outcome_unknown' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('completes only when both mutations return results', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ data: { create_item: { id: '123' } } }))
      .mockResolvedValueOnce(Response.json({ data: { create_update: { id: '789' } } }))
    expect(
      await withSyncTransport(() =>
        mondayHook.run(
          event,
          { channelId: '456' },
          {
            accessToken: 'test-token',
            rootUrl: 'https://workspace.test',
          }
        )
      )
    ).toEqual({ state: 'succeeded', result: { externalId: '123' } })
  })
})
