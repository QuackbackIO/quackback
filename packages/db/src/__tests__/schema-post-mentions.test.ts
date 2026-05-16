import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { postMentions } from '../schema/post-mentions'

describe('post_mentions schema', () => {
  it('has correct table name', () => {
    expect(getTableName(postMentions)).toBe('post_mentions')
  })

  it('exposes id, postId, principalId, notifiedAt, createdAt', () => {
    const columns = Object.keys(getTableColumns(postMentions))
    expect(columns).toEqual(
      expect.arrayContaining(['id', 'postId', 'principalId', 'notifiedAt', 'createdAt'])
    )
  })

  it('postId, principalId, createdAt are not null; notifiedAt is nullable', () => {
    const cols = getTableColumns(postMentions)
    expect(cols.postId.notNull).toBe(true)
    expect(cols.principalId.notNull).toBe(true)
    expect(cols.createdAt.notNull).toBe(true)
    expect(cols.notifiedAt.notNull).toBe(false)
  })

  it('has a unique index on (post_id, principal_id)', () => {
    const cfg = getTableConfig(postMentions)
    const uq = cfg.indexes.find((i) => i.config.name === 'post_mentions_post_principal_uq')
    expect(uq).toBeDefined()
    expect(uq?.config.unique).toBe(true)
    const cols = (uq?.config.columns ?? []).map((c) =>
      typeof c === 'object' && c !== null && 'name' in c ? (c as { name: string }).name : ''
    )
    expect(cols).toEqual(['post_id', 'principal_id'])
  })

  it('has an index on (principal_id, created_at DESC)', () => {
    const cfg = getTableConfig(postMentions)
    const idx = cfg.indexes.find((i) => i.config.name === 'post_mentions_principal_idx')
    expect(idx).toBeDefined()
    expect(idx?.config.unique).toBeFalsy()
  })

  it('cascades delete from posts', () => {
    const cfg = getTableConfig(postMentions)
    const fkToPosts = cfg.foreignKeys.find((fk) => {
      const ref = fk.reference()
      return getTableName(ref.foreignTable) === 'posts'
    })
    expect(fkToPosts).toBeDefined()
    expect(fkToPosts?.onDelete).toBe('cascade')
  })

  it('cascades delete from principal', () => {
    const cfg = getTableConfig(postMentions)
    const fkToPrincipal = cfg.foreignKeys.find((fk) => {
      const ref = fk.reference()
      return getTableName(ref.foreignTable) === 'principal'
    })
    expect(fkToPrincipal).toBeDefined()
    expect(fkToPrincipal?.onDelete).toBe('cascade')
  })
})
