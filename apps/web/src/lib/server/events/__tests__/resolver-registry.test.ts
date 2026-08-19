import { describe, it, expect, beforeEach } from 'vitest'
import { createId } from '@quackback/ids'
import { registerResolver, resolveTargets, __resetResolversForTests } from '../resolvers/registry'
import type { DomainEvent } from '../envelope'

function evt(type: string): DomainEvent {
  return {
    eventId: createId('event'),
    seq: 1n,
    type,
    entityType: 'post',
    entityId: createId('post'),
    actorType: 'user',
    payload: {},
    context: { depth: 0 },
    schemaVersion: 1,
    occurredAt: new Date(),
  }
}

describe('resolver registry', () => {
  beforeEach(() => __resetResolversForTests())

  it('concatenates targets from every interested resolver', async () => {
    registerResolver({
      sink: 'a',
      interestedIn: (t) => t === 'post.created',
      resolve: async () => [{ type: 'a', target: { x: 1 }, config: {} }],
    })
    registerResolver({
      sink: 'b',
      interestedIn: () => true,
      resolve: async () => [{ type: 'b', target: { y: 2 }, config: {} }],
    })

    const targets = await resolveTargets(evt('post.created'))
    expect(targets.map((t) => t.type).sort()).toEqual(['a', 'b'])
  })

  it('skips resolvers whose interestedIn returns false', async () => {
    registerResolver({
      sink: 'a',
      interestedIn: (t) => t === 'comment.created',
      resolve: async () => [{ type: 'a', target: {}, config: {} }],
    })
    const targets = await resolveTargets(evt('post.created'))
    expect(targets).toEqual([])
  })

  it('rejects when any interested resolver fails so the relay can retry', async () => {
    registerResolver({
      sink: 'boom',
      interestedIn: () => true,
      resolve: async () => {
        throw new Error('sink exploded')
      },
    })
    registerResolver({
      sink: 'ok',
      interestedIn: () => true,
      resolve: async () => [{ type: 'ok', target: {}, config: {} }],
    })
    await expect(resolveTargets(evt('post.created'))).rejects.toThrow(
      'Failed to resolve boom targets'
    )
  })
})
