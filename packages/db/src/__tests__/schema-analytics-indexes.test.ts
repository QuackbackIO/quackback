import { describe, it, expect } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { session } from '../schema/auth'
import { comments } from '../schema/posts'

/**
 * Indexes that back the analytics dashboard's active-users and
 * time-to-resolution queries. Without these, both queries seq-scan tables that
 * grow over time. Pinning them in the schema keeps the Drizzle model in step
 * with migration 0105.
 */
describe('analytics support indexes', () => {
  it('session has an index on updated_at (active-users range scan)', () => {
    const cfg = getTableConfig(session)
    const idx = cfg.indexes.find((i) => i.config.name === 'session_updatedAt_idx')
    expect(idx).toBeDefined()
    const cols = (idx?.config.columns ?? []).map((c) =>
      typeof c === 'object' && c !== null && 'name' in c ? (c as { name: string }).name : ''
    )
    expect(cols).toEqual(['updated_at'])
  })

  it('comments has a partial index on status_change_to_id (TTR join)', () => {
    const cfg = getTableConfig(comments)
    const idx = cfg.indexes.find((i) => i.config.name === 'comments_status_change_to_id_idx')
    expect(idx).toBeDefined()
    const cols = (idx?.config.columns ?? []).map((c) =>
      typeof c === 'object' && c !== null && 'name' in c ? (c as { name: string }).name : ''
    )
    expect(cols).toEqual(['status_change_to_id'])
    // Partial: the column is NULL on ordinary comments, so the index only
    // covers the sparse status-change rows the join needs.
    expect(idx?.config.where).toBeDefined()
  })
})
