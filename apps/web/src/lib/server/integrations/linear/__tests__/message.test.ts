/**
 * Tests for Linear message builder.
 */

import { describe, it, expect } from 'vitest'
import type { PostCreatedEvent, EventData } from '../../../events/types'
import { buildLinearIssueBody } from '../message'

function makePostCreatedEvent(overrides: Record<string, unknown> = {}): PostCreatedEvent {
  return {
    id: 'evt-1',
    type: 'post.created',
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1', email: 'test@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Feature request',
        content: '<p>Please add dark mode</p>',
        boardId: 'board_1',
        boardSlug: 'features',
        voteCount: 5,
        authorName: 'Jane Doe',
        authorEmail: 'jane@example.com',
        ...overrides,
      },
    },
  }
}

describe('buildLinearIssueBody', () => {
  it('builds title and description from post.created event', () => {
    const result = buildLinearIssueBody(makePostCreatedEvent(), 'https://feedback.example.com')

    expect(result.title).toBe('Feature request')
    expect(result.description).toContain('Please add dark mode')
    expect(result.description).toContain('**Submitted by:** Jane Doe')
    expect(result.description).toContain('**Board:** features')
    expect(result.description).toContain(
      '[View in Quackback](https://feedback.example.com/b/features/posts/post_1)'
    )
  })

  it('does not include vote count', () => {
    const result = buildLinearIssueBody(makePostCreatedEvent(), 'https://feedback.example.com')

    expect(result.description).not.toContain('Votes')
    expect(result.description).not.toContain('voteCount')
  })

  it('falls back to email when authorName is missing', () => {
    const result = buildLinearIssueBody(
      makePostCreatedEvent({ authorName: undefined }),
      'https://feedback.example.com'
    )

    expect(result.description).toContain('**Submitted by:** jane@example.com')
  })

  it('falls back to Anonymous when no author info', () => {
    const result = buildLinearIssueBody(
      makePostCreatedEvent({ authorName: undefined, authorEmail: undefined }),
      'https://feedback.example.com'
    )

    expect(result.description).toContain('**Submitted by:** Anonymous')
  })

  it('returns fallback for non post.created events', () => {
    const event = { type: 'post.status_changed' } as unknown as EventData
    const result = buildLinearIssueBody(event, 'https://example.com')

    expect(result.title).toBe('Feedback')
    expect(result.description).toBe('')
  })
})
