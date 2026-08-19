import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getOpenAI } = vi.hoisted(() => ({ getOpenAI: vi.fn<() => unknown>() }))
vi.mock('@/lib/server/domains/ai/config', () => ({ getOpenAI }))

import { createId } from '@quackback/ids'
import { aiResolver, summaryResolver } from '../resolvers/ai.resolver'
import type { DomainEvent } from '../envelope'

/** WO-8d — AI + summary resolvers: fixed type lists, gated on a configured model. */

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

describe('ai + summary resolvers (WO-8d)', () => {
  beforeEach(() => getOpenAI.mockReset())

  it('interestedIn matches the fixed type lists', () => {
    expect(aiResolver.interestedIn('post.created')).toBe(true)
    expect(aiResolver.interestedIn('comment.created')).toBe(false)
    expect(summaryResolver.interestedIn('post.created')).toBe(true)
    expect(summaryResolver.interestedIn('comment.created')).toBe(true)
    expect(summaryResolver.interestedIn('post.deleted')).toBe(false)
  })

  it('yields a target only when an AI model is configured', async () => {
    getOpenAI.mockReturnValue({})
    expect(await aiResolver.resolve(evt('post.created'))).toEqual([
      { type: 'ai', target: { type: 'ai' }, config: {} },
    ])
    expect(await summaryResolver.resolve(evt('comment.created'))).toEqual([
      { type: 'summary', target: { type: 'summary' }, config: {} },
    ])
  })

  it('yields nothing when no AI model is configured', async () => {
    getOpenAI.mockReturnValue(undefined)
    expect(await aiResolver.resolve(evt('post.created'))).toEqual([])
    expect(await summaryResolver.resolve(evt('post.created'))).toEqual([])
  })
})
