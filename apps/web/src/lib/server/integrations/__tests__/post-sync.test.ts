import { getIntegration } from '@/lib/server/integrations'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PostId } from '@quackback/ids'
const state = vi.hoisted(() => ({
  post: {} as Record<string, unknown>,
  links: [] as Array<Record<string, unknown>>,
  resolve: vi.fn(),
  queue: vi.fn(),
  hook: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      posts: { findFirst: async () => state.post },
      boards: { findFirst: async () => ({ slug: 'bugs' }) },
      integrations: {
        findFirst: async (_query: { where: unknown }) => {
          // Drizzle predicates are checked in the real PostgreSQL delivery tests; this seam supplies the connection.
          return {
            id: 'linear',
            integrationType: 'linear',
            status: 'active',
            connectedAt: null,
            config: { channelId: 'team' },
          }
        },
      },
    },
    select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => state.links }) }) }),
  },
}))
vi.mock('../index', () => ({
  getIntegration: (provider: string) =>
    ['slack', 'discord', 'teams'].includes(provider) ? {} : { linkedItems: true },
}))
vi.mock('@/lib/server/events/resolvers/integration.resolver', () => ({
  integrationResolver: { resolve: state.resolve },
}))
vi.mock('../sync/ledger', () => ({ queueSyncOperation: state.queue }))
vi.mock('../sync/hooks', () => ({ queueHookSync: state.hook }))
import { syncPostIntegrations } from '../post-sync'
import { syncDestination, syncHash, installationIdentity } from '../sync/identity'
const id = createId('post') as PostId
const target = (channelId = 'team') => ({
  type: 'linear',
  target: { channelId },
  config: { integrationId: 'linear' },
})
const link = (externalId: string) => ({
  link: {
    id: externalId,
    externalId,
    externalUrl: `https://linear.app/test/issue/${externalId}`,
    syncScope: `${installationIdentity({ id: 'linear', connectedAt: null })}:${syncHash(syncDestination({ channelId: 'team' }, { channelId: 'team' }, getIntegration('linear')))}`,
  },
  integration: {
    id: 'linear',
    integrationType: 'linear',
    connectedAt: null,
    status: 'active',
    config: { channelId: 'team' },
  },
})
beforeEach(() => {
  vi.clearAllMocks()
  state.post = {
    id,
    title: 'Title',
    content: 'Narrative',
    boardId: createId('board'),
    moderationState: 'published',
    updatedAt: new Date(),
  }
  state.links = []
  state.resolve.mockResolvedValue([target()])
  state.queue.mockImplementation(async (intent) => ({
    id: intent.operationKey,
    state: intent.state ?? 'queued',
  }))
  state.hook.mockResolvedValue({ id: 'queued-create', state: 'queued' })
})
describe('integration post sync', () => {
  it.each(['slack', 'discord', 'teams'])(
    'does not offer a manual issue refresh for a %s notification receipt',
    async (provider) => {
      const receipt = link('message-receipt')
      state.links = [
        { ...receipt, integration: { ...receipt.integration, integrationType: provider } },
      ]
      state.hook.mockResolvedValue({ id: 'completed', state: 'succeeded' })
      expect(await syncPostIntegrations(id)).toEqual({
        queued: false,
        needsAttention: false,
        operationIds: ['completed'],
      })
      expect(state.queue).not.toHaveBeenCalled()
    }
  )
  it('queues each missing destination without replaying the event bus', async () => {
    state.resolve.mockResolvedValue([target(), target('other-team')])
    expect((await syncPostIntegrations(id)).queued).toBe(true)
    expect(state.hook.mock.calls.map(([data]) => data.target.channelId)).toEqual([
      'team',
      'other-team',
    ])
  })
  it('reuses a completed operation without suppressing other destinations', async () => {
    state.hook.mockImplementation(async (data) => ({
      id: data.target.channelId,
      state: data.target.channelId === 'team' ? 'succeeded' : 'queued',
    }))
    state.resolve.mockResolvedValue([target(), target('other-team')])
    const result = await syncPostIntegrations(id)
    expect(state.hook.mock.calls.map(([data]) => data.target.channelId)).toEqual([
      'team',
      'other-team',
    ])
    expect(result).toMatchObject({ queued: true, operationIds: ['team', 'other-team'] })
  })
  it('represents every linked refresh for review, preserving canonical rich media', async () => {
    state.post.contentJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Narrative' }] },
        { type: 'resizableImage', attrs: { src: '/api/storage/shot.png', alt: 'Screenshot' } },
      ],
    }
    state.links = [link('one'), link('two')]
    state.resolve.mockResolvedValue([])
    expect(await syncPostIntegrations(id)).toMatchObject({
      queued: false,
      needsAttention: true,
    })
    expect(state.queue.mock.calls.map(([op]) => op.remoteId)).toEqual(['one', 'two'])
    for (const [op] of state.queue.mock.calls) {
      expect(op.payload.data.event.data.post.content).toContain(
        '![Screenshot](/api/storage/shot.png)'
      )
      expect(op.state).toBe('conflict')
    }
    expect(state.refresh).not.toHaveBeenCalled()
  })
  it('does not import or refresh a reference-only link or a skipped historic create', async () => {
    state.links = [{ ...link('old'), link: { ...link('old').link, syncScope: '' } }]
    state.hook.mockResolvedValue(null)
    expect(await syncPostIntegrations(id)).toMatchObject({
      queued: false,
      needsAttention: false,
      operationIds: [],
    })
    expect(state.queue).not.toHaveBeenCalled()
  })
  it('continues independent destinations and returns a sanitized queue error', async () => {
    state.resolve.mockResolvedValue([target(), target('other-team')])
    state.hook.mockRejectedValueOnce(new Error('accessToken=private-secret'))
    await expect(syncPostIntegrations(id)).rejects.toThrow('Some integrations could not be queued.')
    expect(state.hook).toHaveBeenCalledTimes(2)
  })
  it('reports completed work without claiming it was queued', async () => {
    state.hook.mockResolvedValue({ id: 'completed', state: 'succeeded' })
    expect(await syncPostIntegrations(id)).toMatchObject({
      queued: false,
      needsAttention: false,
    })
  })
  it.each([{ deletedAt: new Date() }, { moderationState: 'pending' }])(
    'rejects unavailable sources',
    async (change) => {
      Object.assign(state.post, change)
      await expect(syncPostIntegrations(id)).rejects.toThrow()
      expect(state.resolve).not.toHaveBeenCalled()
    }
  )
})
