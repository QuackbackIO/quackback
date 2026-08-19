/**
 * Renders `buildKeysetCondition`'s output through a real `PgDialect` (no live
 * database needed) and asserts the exact SQL text + bound params, so the
 * composite assembly is verified byte-for-byte rather than by structural
 * shape alone — the thing most likely to silently regress (a missing
 * AND-prefix dupes/skips rows across a page boundary).
 */
import { describe, expect, it } from 'vitest'
import { PgDialect, pgTable, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { eq, gt, isNull, or } from 'drizzle-orm'
import { ascColumn, buildKeysetCondition, descColumn, type KeysetColumn } from '../keyset'

const dialect = new PgDialect()
const t = pgTable('t', {
  id: integer('id'),
  rank: integer('rank'),
  createdAt: timestamp('created_at'),
  waitingSince: timestamp('waiting_since'),
  label: text('label'),
})

function render(col: ReturnType<typeof buildKeysetCondition>) {
  return dialect.sqlToQuery(col)
}

describe('buildKeysetCondition', () => {
  it('single column (id-only tiebreak): just the strict clause', () => {
    const { sql, params } = render(buildKeysetCondition([descColumn(t.id, 7)]))
    expect(sql).toBe('"t"."id" < $1')
    expect(params).toEqual([7])
  })

  it('two columns desc+id (the priority-rank shape): strict(0) OR (equal(0) AND strict(1))', () => {
    const cols: KeysetColumn[] = [descColumn(t.rank, 5), descColumn(t.id, 'abc')]
    const { sql, params } = render(buildKeysetCondition(cols))
    expect(sql).toBe('("t"."rank" < $1 or ("t"."rank" = $2 and "t"."id" < $3))')
    expect(params).toEqual([5, 5, 'abc'])
  })

  it('two columns asc+id: matches the createdAt/updatedAt "oldest" shape', () => {
    const cursorDate = new Date('2026-01-01T00:00:00.000Z')
    const cols: KeysetColumn[] = [ascColumn(t.createdAt, cursorDate), ascColumn(t.id, 'xyz')]
    const { sql, params } = render(buildKeysetCondition(cols))
    expect(sql).toBe('("t"."created_at" > $1 or ("t"."created_at" = $2 and "t"."id" > $3))')
    expect(params).toEqual([cursorDate.toISOString(), cursorDate.toISOString(), 'xyz'])
  })

  it("three columns (rank, activity, id): matches conversation.query.ts's priorityRank shape", () => {
    const activity = new Date('2026-02-02T00:00:00.000Z')
    const cols: KeysetColumn[] = [
      descColumn(t.rank, 4),
      descColumn(t.createdAt, activity),
      descColumn(t.id, 'c1'),
    ]
    const { sql, params } = render(buildKeysetCondition(cols))
    expect(sql).toBe(
      '("t"."rank" < $1 or ("t"."rank" = $2 and "t"."created_at" < $3) or ("t"."rank" = $4 and "t"."created_at" = $5 and "t"."id" < $6))'
    )
    expect(params).toEqual([4, 4, activity.toISOString(), 4, activity.toISOString(), 'c1'])
  })

  it('a NULLS-LAST column whose cursor value is null: only the id tiebreak can diverge', () => {
    // Mirrors conversation.query.ts's waitingSince ASC NULLS LAST cursor when
    // the cursor row is itself already in the null tail: `and(isNull(col),
    // gt(id, cursorId))` — nothing sorts "more null", so this column
    // contributes no `strict` of its own.
    const cols: KeysetColumn[] = [
      { equal: isNull(t.waitingSince), strict: undefined },
      ascColumn(t.id, 'c1'),
    ]
    const { sql, params } = render(buildKeysetCondition(cols))
    expect(sql).toBe('("t"."waiting_since" is null and "t"."id" > $1)')
    expect(params).toEqual(['c1'])
  })

  it('a NULLS-LAST column whose cursor value is non-null: strict includes the whole null tail', () => {
    // Mirrors the non-null branch: `or(gt(col, val), and(eq(col, val), gt(id,
    // cursorId)), isNull(col))` — a later row further along OR the entire
    // null tail (NULLS LAST sorts every null row after every non-null row)
    // OR a same-instant id tiebreak.
    const waiting = new Date('2026-03-03T00:00:00.000Z')
    // NULLS-LAST "strict" isn't a single operator — it's "greater than OR
    // null" (the whole tail), assembled the same way a call site would.
    const nullsLastStrict = or(gt(t.waitingSince, waiting), isNull(t.waitingSince))
    const composed: KeysetColumn[] = [
      { equal: eq(t.waitingSince, waiting), strict: nullsLastStrict },
      ascColumn(t.id, 'c1'),
    ]
    const { sql, params } = render(buildKeysetCondition(composed))
    expect(sql).toBe(
      '(("t"."waiting_since" > $1 or "t"."waiting_since" is null) or ("t"."waiting_since" = $2 and "t"."id" > $3))'
    )
    expect(params).toEqual([waiting.toISOString(), waiting.toISOString(), 'c1'])
  })

  it('an id-only tiebreak with no other columns still renders (never an empty OR)', () => {
    const { sql, params } = render(buildKeysetCondition([ascColumn(t.id, 1)]))
    expect(sql).toBe('"t"."id" > $1')
    expect(params).toEqual([1])
  })
})
