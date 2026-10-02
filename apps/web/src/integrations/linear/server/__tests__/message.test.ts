/**
 * Tests for Linear message builder.
 */

import { describe, it, expect } from 'vitest'
import type { PostCreatedEvent, CommentCreatedEvent, EventData } from '@/lib/server/events/types'
import { buildLinearIssueBody, buildLinearCommentBody } from '@/integrations/linear/server/message'

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

  it('turns stored image paths into absolute URLs Linear can import', () => {
    const result = buildLinearIssueBody(
      makePostCreatedEvent({
        content: 'Before\n\n![Block menu](/api/storage/portal-media/block-menu.png)\n\nAfter',
      }),
      'https://say.any.org'
    )

    expect(result.description).toContain(
      '![Block menu](https://say.any.org/api/storage/portal-media/block-menu.png)'
    )
    expect(result.description).not.toContain('](/api/storage/')
  })

  it('embeds stored videos with absolute URLs so Linear copies them to private storage', () => {
    const result = buildLinearIssueBody(
      makePostCreatedEvent({
        content:
          'Reproduction\n\n[/api/storage/portal-media/recording.mov](/api/storage/portal-media/recording.mov)',
      }),
      'https://say.any.org/'
    )

    expect(result.description).toContain(
      '![Video: recording.mov](https://say.any.org/api/storage/portal-media/recording.mov)'
    )
    expect(result.description).not.toContain('](/api/storage/')
  })

  it('keeps every media item even when the narrative is truncated', () => {
    const result = buildLinearIssueBody(
      makePostCreatedEvent({
        content: `${'Long report '.repeat(250)}\n\n![Late screenshot](/api/storage/portal-media/late.png)`,
      }),
      'https://say.any.org'
    )

    expect(result.description).toContain(
      '![Late screenshot](https://say.any.org/api/storage/portal-media/late.png)'
    )
  })

  it('recovers media from legacy HTML content', () => {
    const result = buildLinearIssueBody(
      makePostCreatedEvent({
        content:
          '<p>Steps</p><img src="/api/storage/portal-media/shot.webp" alt="Shot"><video src="/api/storage/portal-media/demo.mp4" title="Demo"></video>',
      }),
      'https://say.any.org'
    )

    expect(result.description).toContain(
      '![Shot](https://say.any.org/api/storage/portal-media/shot.webp)'
    )
    expect(result.description).toContain(
      '![Video: Demo](https://say.any.org/api/storage/portal-media/demo.mp4)'
    )
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

function makeCommentCreatedEvent(overrides: Record<string, unknown> = {}): CommentCreatedEvent {
  return {
    id: 'evt-2',
    type: 'comment.created',
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_2', email: 'sam@example.com' },
    data: {
      comment: {
        id: 'comment_1',
        content: 'Happens on Safari too',
        authorName: 'Sam Lee',
        authorEmail: 'sam@example.com',
        isPrivate: false,
        ...overrides,
      },
      post: { id: 'post_1', title: 'Feature request', boardId: 'board_1', boardSlug: 'features' },
    },
  }
}

describe('buildLinearCommentBody', () => {
  it('names the author, keeps the text, and deep-links to the comment', () => {
    const body = buildLinearCommentBody(makeCommentCreatedEvent(), 'https://feedback.example.com')

    expect(body).toContain('**Sam Lee commented:**')
    expect(body).toContain('Happens on Safari too')
    expect(body).toContain(
      '[View comment in Quackback](https://feedback.example.com/b/features/posts/post_1#comment-comment_1)'
    )
  })

  it('turns stored media paths into absolute URLs Linear can import', () => {
    const body = buildLinearCommentBody(
      makeCommentCreatedEvent({
        content: 'See\n\n![Shot](/api/storage/portal-media/shot.png)',
      }),
      'https://say.any.org'
    )

    expect(body).toContain('![Shot](https://say.any.org/api/storage/portal-media/shot.png)')
    expect(body).not.toContain('](/api/storage/')
  })

  it('keeps comment text up to 5000 characters before shortening', () => {
    const text = 'x'.repeat(3000)
    const body = buildLinearCommentBody(
      makeCommentCreatedEvent({ content: text }),
      'https://x.test'
    )

    expect(body).toContain(text)
  })

  it('falls back to email, then Anonymous, when the author name is missing', () => {
    expect(
      buildLinearCommentBody(makeCommentCreatedEvent({ authorName: undefined }), 'https://x.test')
    ).toContain('**sam@example.com commented:**')
    expect(
      buildLinearCommentBody(
        makeCommentCreatedEvent({ authorName: undefined, authorEmail: undefined }),
        'https://x.test'
      )
    ).toContain('**Anonymous commented:**')
  })
})
