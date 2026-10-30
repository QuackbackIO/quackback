/**
 * Target resolution for the subscribed-you bell (post.subscriber_added): the
 * person a teammate (or an automation) subscribed hears about it, once, if
 * they can still see the post; nobody is belled for following a post
 * themselves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'

// db: the actor's principal, for their name (the relayed event carries none)
const actorRows: unknown[][] = []
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => {
      const rows = actorRows.shift() ?? []
      const chain: Record<string, unknown> = {}
      for (const m of ['from', 'where', 'limit']) chain[m] = () => chain
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res)
      return chain
    },
  },
}))

const canView = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/posts/post.access', () => ({
  principalsWhoCanViewPost: (...a: unknown[]) => canView(...a),
}))
vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  getBaseUrl: () => 'https://acme.test',
}))

const { getPostSubscriberAddedTargets } = await import('../targets')

beforeEach(() => {
  actorRows.length = 0
  canView.mockReset()
  canView.mockImplementation(async (_postId: string, ids: string[]) => new Set(ids))
})

function addedEvent(actor: EventData['actor'], subscriberPrincipalId = 'principal_ada'): EventData {
  return {
    id: 'evt-1',
    type: 'post.subscriber_added',
    timestamp: '2026-01-01T00:00:00Z',
    actor,
    data: {
      post: { id: 'post_1', title: 'Dark mode', boardId: 'board_1', boardSlug: 'ideas' },
      subscriberPrincipalId,
      reason: 'added',
    },
  } as EventData
}

describe('getPostSubscriberAddedTargets', () => {
  it('bells the person a teammate subscribed, naming who did it and linking the post', async () => {
    const target = await getPostSubscriberAddedTargets(
      addedEvent({ type: 'user', principalId: 'principal_lead', displayName: 'Lea' })
    )
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_ada'] },
      config: {
        postId: 'post_1',
        postTitle: 'Dark mode',
        boardSlug: 'ideas',
        postUrl: 'https://acme.test/b/ideas/posts/post_1',
        authorName: 'Lea',
      },
    })
    expect(canView).toHaveBeenCalledWith('post_1', ['principal_ada'])
  })

  it("reads the teammate's name from their principal, as the relayed event carries none", async () => {
    actorRows.push([{ displayName: 'Lea' }])
    const relayed = await getPostSubscriberAddedTargets(
      addedEvent({ type: 'user', principalId: 'principal_lead' })
    )
    expect(relayed?.config).toMatchObject({ authorName: 'Lea' })
  })

  it('names an automation, and falls back for a nameless teammate', async () => {
    const service = await getPostSubscriberAddedTargets(addedEvent({ type: 'service' }))
    expect(service?.config).toMatchObject({ authorName: 'An automation' })
    actorRows.push([{ displayName: null }])
    const nameless = await getPostSubscriberAddedTargets(
      addedEvent({ type: 'user', principalId: 'principal_lead' })
    )
    expect(nameless?.config).toMatchObject({ authorName: 'A teammate' })
  })

  it('bells nobody for following a post themselves', async () => {
    expect(
      await getPostSubscriberAddedTargets(
        addedEvent({ type: 'user', principalId: 'principal_ada' })
      )
    ).toBeNull()
    expect(canView).not.toHaveBeenCalled()
  })

  it('bells nobody who can no longer see the post', async () => {
    canView.mockResolvedValue(new Set())
    expect(
      await getPostSubscriberAddedTargets(
        addedEvent({ type: 'user', principalId: 'principal_lead', displayName: 'Lea' })
      )
    ).toBeNull()
  })
})
