import { describe, it, expect } from 'vitest'
import { createId } from '@quackback/ids'
import { boardIdsFromEvent, webhookMatches, webhookResolver } from '../resolvers/webhook.resolver'
import type { DomainEvent } from '../envelope'

/**
 * WO-8a — the webhook resolver's pure matching logic (board extraction, event-type
 * + board-overlap match, private-comment guard, catalogue-derived interest).
 * End-to-end coverage rides the relay + dispatch-outbox-parity suites.
 */

function evt(type: string, payload: Record<string, unknown>): DomainEvent {
  return {
    eventId: createId('event'),
    seq: 1n,
    type,
    entityType: 'post',
    entityId: createId('post'),
    actorType: 'user',
    payload,
    context: { depth: 0 },
    schemaVersion: 1,
    occurredAt: new Date(),
  }
}

describe('webhook resolver (WO-8a)', () => {
  it('interestedIn is catalogue-derived (exposure.webhook)', () => {
    expect(webhookResolver.interestedIn('post.created')).toBe(true)
    // post.mentioned + status.* are not webhook-exposed
    expect(webhookResolver.interestedIn('post.mentioned')).toBe(false)
    expect(webhookResolver.interestedIn('status.component_changed')).toBe(false)
  })

  it('boardIdsFromEvent digs the board from post + merge payloads', () => {
    const b = createId('board')
    expect(boardIdsFromEvent(evt('post.created', { post: { boardId: b } }))).toEqual([b])

    const b1 = createId('board')
    const b2 = createId('board')
    const merged = boardIdsFromEvent(
      evt('post.merged', { duplicatePost: { boardId: b1 }, canonicalPost: { boardId: b2 } })
    )
    expect(new Set(merged)).toEqual(new Set([b1, b2]))

    // board-less event
    expect(boardIdsFromEvent(evt('conversation.created', { conversation: { id: 'x' } }))).toEqual(
      []
    )
  })

  it('webhookMatches respects event subscription + board filter', () => {
    const b1 = createId('board')
    const b2 = createId('board')
    // subscribed to the type, no board filter -> match
    expect(webhookMatches({ events: ['post.created'], boardIds: null }, 'post.created', [b1])).toBe(
      true
    )
    // not subscribed to the type -> no match
    expect(
      webhookMatches({ events: ['comment.created'], boardIds: null }, 'post.created', [b1])
    ).toBe(false)
    // board filter overlaps -> match
    expect(webhookMatches({ events: ['post.created'], boardIds: [b1] }, 'post.created', [b1])).toBe(
      true
    )
    // board filter with no overlap -> no match
    expect(webhookMatches({ events: ['post.created'], boardIds: [b2] }, 'post.created', [b1])).toBe(
      false
    )
    // board-bearing filter but board-less event -> match on type alone
    expect(
      webhookMatches(
        { events: ['conversation.created'], boardIds: [b1] },
        'conversation.created',
        []
      )
    ).toBe(true)
  })

  it('drops private comments before any webhook lookup', async () => {
    const target = await webhookResolver.resolve(
      evt('comment.created', { comment: { isPrivate: true }, post: { boardId: createId('board') } })
    )
    expect(target).toEqual([])
  })
})
