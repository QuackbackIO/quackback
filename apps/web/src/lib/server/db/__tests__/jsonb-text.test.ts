/**
 * Renders `mergeJsonbText` through a real `PgDialect` (no live database
 * needed). The removed keys must bind as a Postgres array literal: an
 * interpolated JS array renders `()::text[]` / `($1, $2)::text[]`, which
 * Postgres rejects, and that broke every repeat widget identify that carried
 * custom attributes.
 */
import { describe, expect, it } from 'vitest'
import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core'
import { mergeJsonbText } from '../jsonb-text'

const dialect = new PgDialect()
const t = pgTable('t', { metadata: text('metadata') })

describe('mergeJsonbText', () => {
  it('renders an empty ARRAY when there is nothing to remove', () => {
    const q = dialect.sqlToQuery(mergeJsonbText(t.metadata, { plan: 'pro' }))
    expect(q.sql).toBe(
      `((coalesce(nullif("t"."metadata", ''), '{}')::jsonb - ARRAY[]::text[]) || $1::jsonb)::text`
    )
    expect(q.params).toEqual(['{"plan":"pro"}'])
  })

  it('binds each removed key as an ARRAY element', () => {
    const q = dialect.sqlToQuery(mergeJsonbText(t.metadata, {}, ['plan', '$externalId']))
    expect(q.sql).toBe(
      `((coalesce(nullif("t"."metadata", ''), '{}')::jsonb - ARRAY[$1, $2]::text[]) || $3::jsonb)::text`
    )
    expect(q.params).toEqual(['plan', '$externalId', '{}'])
  })

  it('never renders a parenthesised list cast to text[]', () => {
    for (const removals of [[], ['a'], ['a', 'b']]) {
      const q = dialect.sqlToQuery(mergeJsonbText(t.metadata, { a: 1 }, removals))
      expect(q.sql).not.toMatch(/\(\s*(\$\d+(,\s*\$\d+)*)?\s*\)::text\[\]/)
    }
  })
})
