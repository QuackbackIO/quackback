import { describe, it, expect } from 'vitest'
import { buildNtfyPayload } from '../message'

const ROOT = 'https://app.example.com'
const TOPIC = 'my-topic'

function postCreatedEvent() {
  return {
    id: 'evt-1',
    type: 'post.created' as const,
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user' as const },
    data: {
      post: {
        id: 'post_1',
        title: 'Dark mode support',
        content: '<p>Please add dark mode</p>',
        boardId: 'board_1',
        boardSlug: 'features',
        voteCount: 0,
      },
    },
  }
}

function statusChangedEvent() {
  return {
    id: 'evt-2',
    type: 'post.status_changed' as const,
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user' as const },
    data: {
      post: { id: 'post_1', title: 'Dark mode support', boardId: 'board_1', boardSlug: 'features' },
      previousStatus: 'open',
      newStatus: 'in_progress',
    },
  }
}

function commentCreatedEvent() {
  return {
    id: 'evt-3',
    type: 'comment.created' as const,
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user' as const },
    data: {
      comment: { id: 'comment_1', content: '<p>Great idea!</p>' },
      post: { id: 'post_1', title: 'Dark mode support', boardId: 'board_1', boardSlug: 'features' },
    },
  }
}

describe('buildNtfyPayload', () => {
  it('returns correct payload for post.created', () => {
    const payload = buildNtfyPayload(postCreatedEvent() as any, TOPIC, ROOT)
    expect(payload).not.toBeNull()
    expect(payload!.topic).toBe(TOPIC)
    expect(payload!.title).toBe('New feedback: Dark mode support')
    expect(payload!.message).toContain('dark mode')
    expect(payload!.click).toBe(`${ROOT}/b/features/posts/post_1`)
    expect(payload!.tags).toContain('speech_balloon')
  })

  it('returns correct payload for post.status_changed', () => {
    const payload = buildNtfyPayload(statusChangedEvent() as any, TOPIC, ROOT)
    expect(payload).not.toBeNull()
    expect(payload!.title).toBe('Status changed: Dark mode support')
    expect(payload!.message).toBe('Open → In Progress')
    expect(payload!.click).toBe(`${ROOT}/b/features/posts/post_1`)
    expect(payload!.tags).toContain('arrows_counterclockwise')
  })

  it('returns correct payload for comment.created', () => {
    const payload = buildNtfyPayload(commentCreatedEvent() as any, TOPIC, ROOT)
    expect(payload).not.toBeNull()
    expect(payload!.title).toBe('New comment: Dark mode support')
    expect(payload!.message).toContain('Great idea')
    expect(payload!.click).toBe(`${ROOT}/b/features/posts/post_1`)
    expect(payload!.tags).toContain('speech_balloon')
  })

  it('returns null for unhandled event types', () => {
    const event = {
      id: 'evt-4',
      type: 'post.deleted' as const,
      timestamp: '2025-01-01T00:00:00Z',
      actor: { type: 'user' as const },
      data: {
        post: { id: 'post_1', title: 'Dark mode support', boardId: 'board_1', boardSlug: 'features' },
      },
    }
    const payload = buildNtfyPayload(event as any, TOPIC, ROOT)
    expect(payload).toBeNull()
  })
})
