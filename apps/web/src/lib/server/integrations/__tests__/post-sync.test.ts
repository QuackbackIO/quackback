import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId } from '@quackback/ids'
const state = vi.hoisted(() => ({
  post: {} as Record<string, unknown>,
  links: [] as Array<Record<string, unknown>>,
  resolve: vi.fn(),
  retry: vi.fn(),
  refresh: vi.fn(),
  refreshOther: vi.fn(),
  writeHealth: vi.fn(),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      posts: { findFirst: async () => state.post },
      boards: { findFirst: async () => ({ slug: 'bugs' }) },
      principal: { findFirst: async () => ({ displayName: 'Reviewer' }) },
    },
    select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => state.links }) }) }),
    update: () => ({
      set: (patch: unknown) => {
        state.writeHealth(patch)
        return { where: async () => undefined }
      },
    }),
  },
}))
vi.mock('../index', () => ({
  getIntegration: (type: string) => ({
    issues: {
      refreshPost:
        type === 'linear' ? state.refresh : type === 'other' ? state.refreshOther : undefined,
    },
  }),
}))
vi.mock('../encryption', () => ({ decryptSecrets: () => ({ accessToken: 'token' }) }))
vi.mock('../token-refresh', () => ({ getValidAccessToken: async () => 'fresh-token' }))
vi.mock('@/lib/server/config', () => ({ getBaseUrl: () => 'https://feedback.test' }))
vi.mock('@/lib/server/events/resolvers/integration.resolver', () => ({
  integrationResolver: { resolve: state.resolve },
}))
vi.mock('@/lib/server/events/process', () => ({
  retryIntegrationDelivery: state.retry,
}))
import { syncPostIntegrations } from '../post-sync'
const id = 'post_1' as PostId
const target = (type: string) => ({
  type,
  target: { channelId: 'team' },
  config: { integrationId: type },
})
const link = (type: string, externalId: string) => ({
  externalId,
  integration: { id: type, integrationType: type, config: {}, secrets: 'encrypted' },
})
beforeEach(() => {
  vi.clearAllMocks()
  state.post = {
    id,
    title: 'Title',
    content: 'Narrative',
    boardId: 'board_1',
    principalId: 'principal_1',
    moderationState: 'published',
  }
  state.links = []
  state.resolve.mockResolvedValue([target('linear')])
  state.retry.mockResolvedValue(true)
  state.refresh.mockResolvedValue(undefined)
  state.refreshOther.mockResolvedValue(undefined)
})
describe('integration post sync', () => {
  it('retries only missing destinations when another provider already has a link', async () => {
    state.links = [link('github', '42')]
    state.resolve.mockResolvedValue([target('github'), target('linear')])
    expect(await syncPostIntegrations(id)).toEqual({ queued: true, updated: false })
    expect(state.retry).toHaveBeenCalledTimes(1)
    expect(state.retry.mock.calls[0][0].hookType).toBe('linear')
  })
  it('refreshes every active link through provider capabilities with canonical legacy media', async () => {
    state.post.contentJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Narrative' }] },
        { type: 'resizableImage', attrs: { src: '/api/storage/shot.png', alt: 'Screenshot' } },
      ],
    }
    state.links = [link('linear', 'one'), link('linear', 'two'), link('other', 'three')]
    expect(await syncPostIntegrations(id)).toEqual({ queued: false, updated: true })
    expect(state.refresh).toHaveBeenCalledTimes(2)
    expect(state.refreshOther).toHaveBeenCalledTimes(1)
    for (const call of [...state.refresh.mock.calls, ...state.refreshOther.mock.calls]) {
      expect(call[0].event.data.post.content).toContain('![Screenshot](/api/storage/shot.png)')
      expect(call[0].auth.accessToken).toBe('fresh-token')
    }
    expect(state.retry).not.toHaveBeenCalled()
  })
  it('propagates queue failures while allowing independent destinations to finish', async () => {
    state.resolve.mockResolvedValue([target('linear'), target('github')])
    state.retry.mockRejectedValueOnce(new Error('queue unavailable')).mockResolvedValueOnce(true)
    await expect(syncPostIntegrations(id)).rejects.toThrow(
      'Some integrations could not be synced. Please try again.'
    )
    expect(state.retry).toHaveBeenCalledTimes(2)
  })
  it('continues refreshing other links when one provider fails and reports failure', async () => {
    state.links = [link('linear', 'one'), link('other', 'two')]
    state.refresh.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(syncPostIntegrations(id)).rejects.toThrow(
      'Some integrations could not be synced. Please try again.'
    )
    expect(state.refreshOther).toHaveBeenCalledOnce()
  })
  it.each(['queue', 'refresh'])(
    'does not expose credentials from %s failures in the response or health record',
    async (source) => {
      const secret = 'test-oauth-secret-must-not-escape'
      const error = new Error(`Failed query: INSERT ... params: {"accessToken":"${secret}"}`)
      if (source === 'queue') state.retry.mockRejectedValueOnce(error)
      else {
        state.links = [link('linear', 'one')]
        state.refresh.mockRejectedValueOnce(error)
      }
      const failure = await syncPostIntegrations(id).catch((e: unknown) => e)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toBe(
        'Some integrations could not be synced. Please try again.'
      )
      expect((failure as Error).cause).toBeUndefined()
      expect(JSON.stringify(state.writeHealth.mock.calls)).not.toContain(secret)
    }
  )
  it('reports a no-op without claiming work was queued', async () => {
    state.retry.mockResolvedValue(false)
    expect(await syncPostIntegrations(id)).toEqual({ queued: false, updated: false })
  })
  it.each([{ deletedAt: new Date() }, { moderationState: 'pending' }])(
    'rejects unavailable posts before resolving destinations',
    async (change) => {
      Object.assign(state.post, change)
      await expect(syncPostIntegrations(id)).rejects.toThrow()
      expect(state.resolve).not.toHaveBeenCalled()
    }
  )
})
