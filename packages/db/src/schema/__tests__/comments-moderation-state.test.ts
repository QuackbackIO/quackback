import { describe, it, expect } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { comments } from '../posts'

describe('comments.moderation_state column', () => {
  it('exists on the comments table', () => {
    const cols = getTableColumns(comments)
    expect(cols.moderationState).toBeDefined()
  })

  it('has the correct enum values (pinned to MODERATION_STATES)', () => {
    const cols = getTableColumns(comments)
    const col = cols.moderationState as unknown as { enumValues: readonly string[] }
    expect(col.enumValues).toEqual([
      'published',
      'pending',
      'spam',
      'archived',
      'closed',
      'deleted',
    ])
  })

  it('defaults to published', () => {
    const cols = getTableColumns(comments)
    const col = cols.moderationState as unknown as { default: string }
    expect(col.default).toBe('published')
  })

  it('is NOT NULL', () => {
    const cols = getTableColumns(comments)
    const col = cols.moderationState as unknown as { notNull: boolean }
    expect(col.notNull).toBe(true)
  })
})
