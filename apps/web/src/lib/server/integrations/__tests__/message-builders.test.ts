/**
 * Tests for all integration message builders.
 *
 * Covers: vote count removal, content formatting, author fallbacks,
 * non-post.created fallback, and platform-specific behaviors.
 */

import { describe, it, expect } from 'vitest'
import type { PostCreatedEvent, EventData } from '../../events/types'
import { buildLinearIssueBody } from '../linear/message'
import { buildGitHubIssueBody } from '../github/message'
import { buildJiraIssueBody } from '../jira/message'
import { buildClickUpTaskBody } from '../clickup/message'
import { buildShortcutStoryBody } from '../shortcut/message'
import { buildAsanaTaskBody } from '../asana/message'
import { buildAzureDevOpsWorkItemBody } from '../azure-devops/message'
import { buildZapierPayload } from '../zapier/message'

// ---------------------------------------------------------------------------
// Shared test event factory
// ---------------------------------------------------------------------------

function makeEvent(overrides: Record<string, unknown> = {}): PostCreatedEvent {
  return {
    id: 'evt-1',
    type: 'post.created',
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1', email: 'actor@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Dark mode support',
        content: '<p>Please add dark mode</p>',
        boardId: 'board_1',
        boardSlug: 'features',
        voteCount: 42,
        authorName: 'Jane Doe',
        authorEmail: 'jane@example.com',
        ...overrides,
      },
    },
  }
}

const ROOT = 'https://feedback.example.com'

// ---------------------------------------------------------------------------
// Markdown-based builders (Linear, GitHub, ClickUp, Shortcut)
// ---------------------------------------------------------------------------

describe.each([
  {
    name: 'Linear',
    build: (e: EventData) => buildLinearIssueBody(e, ROOT),
    bodyKey: 'description',
  },
  { name: 'GitHub', build: (e: EventData) => buildGitHubIssueBody(e, ROOT), bodyKey: 'body' },
  {
    name: 'ClickUp',
    build: (e: EventData) => buildClickUpTaskBody(e, ROOT),
    bodyKey: 'description',
  },
  {
    name: 'Shortcut',
    build: (e: EventData) => buildShortcutStoryBody(e, ROOT),
    bodyKey: 'description',
  },
])('$name message builder', ({ build, bodyKey }) => {
  it('does not include vote count', () => {
    const result = build(makeEvent()) as Record<string, string>
    expect(result[bodyKey]).not.toContain('Votes')
    expect(result[bodyKey]).not.toContain('42')
  })

  it('includes author, board, and link', () => {
    const result = build(makeEvent()) as Record<string, string>
    expect(result[bodyKey]).toContain('Jane Doe')
    expect(result[bodyKey]).toContain('features')
    expect(result[bodyKey]).toContain('View in Quackback')
  })

  it('falls back to email when authorName is missing', () => {
    const result = build(makeEvent({ authorName: undefined })) as Record<string, string>
    expect(result[bodyKey]).toContain('jane@example.com')
  })

  it('falls back to Anonymous when no author info', () => {
    const result = build(makeEvent({ authorName: undefined, authorEmail: undefined })) as Record<
      string,
      string
    >
    expect(result[bodyKey]).toContain('Anonymous')
  })
})

// ---------------------------------------------------------------------------
// HTML-based builders (Asana, Azure DevOps)
// ---------------------------------------------------------------------------

describe.each([
  { name: 'Asana', build: (e: EventData) => buildAsanaTaskBody(e, ROOT), bodyKey: 'htmlNotes' },
  {
    name: 'Azure DevOps',
    build: (e: EventData) => buildAzureDevOpsWorkItemBody(e, ROOT),
    bodyKey: 'description',
  },
])('$name message builder', ({ build, bodyKey }) => {
  it('does not include vote count', () => {
    const result = build(makeEvent()) as Record<string, string>
    expect(result[bodyKey]).not.toContain('Votes')
    expect(result[bodyKey]).not.toContain('42')
  })

  it('includes author and board', () => {
    const result = build(makeEvent()) as Record<string, string>
    expect(result[bodyKey]).toContain('Jane Doe')
    expect(result[bodyKey]).toContain('features')
  })

  it('escapes HTML special characters in author name', () => {
    const result = build(makeEvent({ authorName: 'A <script> & "B"' })) as Record<string, string>
    expect(result[bodyKey]).toContain('&lt;script&gt;')
    expect(result[bodyKey]).toContain('&amp;')
  })
})

// ---------------------------------------------------------------------------
// Jira (ADF format)
// ---------------------------------------------------------------------------

describe('Jira message builder', () => {
  it('does not include vote count in ADF nodes', () => {
    const { description } = buildJiraIssueBody(makeEvent(), ROOT)
    const texts = description.content
      .filter(
        (n): n is { type: 'paragraph'; content: Array<{ type: 'text'; text: string }> } =>
          n.type === 'paragraph'
      )
      .flatMap((p) => p.content.map((t) => t.text))
    expect(texts.join(' ')).not.toContain('Votes')
  })

  it('produces valid ADF structure', () => {
    const { description } = buildJiraIssueBody(makeEvent(), ROOT)
    expect(description.version).toBe(1)
    expect(description.type).toBe('doc')
    expect(description.content.length).toBeGreaterThan(0)
  })

  it('includes author, board, and link in ADF', () => {
    const { description } = buildJiraIssueBody(makeEvent(), ROOT)
    const texts = description.content
      .filter((n) => n.type === 'paragraph')
      .flatMap((p) => ('content' in p ? p.content.map((t) => t.text) : []))
    const joined = texts.join(' ')
    expect(joined).toContain('Jane Doe')
    expect(joined).toContain('features')
    expect(texts).toContain('View in Quackback')
  })

  it('returns fallback ADF for non post.created events', () => {
    const event = { type: 'post.status_changed' } as unknown as EventData
    const { title, description } = buildJiraIssueBody(event, ROOT)
    expect(title).toBe('Feedback')
    expect(description.type).toBe('doc')
  })
})

// ---------------------------------------------------------------------------
// Zapier (structured JSON)
// ---------------------------------------------------------------------------

describe('Zapier message builder', () => {
  it('does not include vote_count in payload', () => {
    const payload = buildZapierPayload(makeEvent(), ROOT)
    expect(payload.post).not.toHaveProperty('vote_count')
  })

  it('includes post metadata', () => {
    const payload = buildZapierPayload(makeEvent(), ROOT)
    expect(payload.event).toBe('post.created')
    expect(payload.post.title).toBe('Dark mode support')
    expect(payload.post.board).toBe('features')
    expect(payload.post.author_name).toBe('Jane Doe')
    expect(payload.post.url).toContain('/b/features/posts/post_1')
  })
})

// ---------------------------------------------------------------------------
// Platform-specific behaviors
// ---------------------------------------------------------------------------

describe('Shortcut title truncation', () => {
  it('truncates titles longer than 512 characters', () => {
    const longTitle = 'A'.repeat(600)
    const { title } = buildShortcutStoryBody(makeEvent({ title: longTitle }), ROOT)
    expect(title.length).toBe(512)
    expect(title.endsWith('...')).toBe(true)
  })

  it('does not truncate short titles', () => {
    const { title } = buildShortcutStoryBody(makeEvent({ title: 'Short' }), ROOT)
    expect(title).toBe('Short')
  })
})

describe('non post.created fallbacks', () => {
  const event = { type: 'post.status_changed' } as unknown as EventData

  it.each([
    { name: 'Linear', build: () => buildLinearIssueBody(event, ROOT) },
    { name: 'GitHub', build: () => buildGitHubIssueBody(event, ROOT) },
    { name: 'ClickUp', build: () => buildClickUpTaskBody(event, ROOT) },
    { name: 'Shortcut', build: () => buildShortcutStoryBody(event, ROOT) },
    { name: 'Asana', build: () => buildAsanaTaskBody(event, ROOT) },
    { name: 'Azure DevOps', build: () => buildAzureDevOpsWorkItemBody(event, ROOT) },
  ])('$name returns fallback title', ({ build }) => {
    const result = build() as Record<string, unknown>
    const title = result.title ?? result.name
    expect(title).toBe('Feedback')
  })
})
