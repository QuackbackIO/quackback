/**
 * SQL-shape tests for the segment-rule typeahead. Uses the same
 * sql-capture mock pattern as segment-evaluation-builtin.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let capturedSql = ''

type SqlValue = string | number | boolean | null | SqlObj | SqlObj[]
interface SqlObj {
  __sql: true
  text: string
}

function makeSql(strings: TemplateStringsArray, ...values: SqlValue[]): SqlObj {
  let text = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v && typeof v === 'object' && '__sql' in v) {
      text += (v as SqlObj).text
    } else if (Array.isArray(v)) {
      text += v
        .map((x) => (x && typeof x === 'object' && '__sql' in x ? x.text : String(x)))
        .join(', ')
    } else {
      text += String(v)
    }
    text += strings[i + 1] ?? ''
  }
  return { __sql: true, text }
}
makeSql.raw = (s: string): SqlObj => ({ __sql: true, text: s })
makeSql.join = (parts: SqlObj[], sep: SqlObj): SqlObj => ({
  __sql: true,
  text: parts.map((p) => p.text).join(sep.text),
})

vi.mock('@/lib/server/db', () => ({
  db: {
    execute: vi.fn(async (sqlObj: SqlObj) => {
      capturedSql = sqlObj.text
      return []
    }),
  },
  sql: makeSql,
}))

import { getAttributeValueSuggestions, SEARCHABLE_ATTRIBUTES } from '../segment-attribute-values'

beforeEach(() => {
  capturedSql = ''
  vi.clearAllMocks()
})

describe('SEARCHABLE_ATTRIBUTES allowlist', () => {
  it('matches the five attributes the segment evaluator can usefully suggest values for', () => {
    expect(SEARCHABLE_ATTRIBUTES).toEqual(
      new Set(['country', 'locale', 'name', 'email', 'signup_source'])
    )
  })
})

describe('getAttributeValueSuggestions — universal predicates', () => {
  it.each(['country', 'locale', 'name', 'email', 'signup_source'] as const)(
    'scopes %s to portal-user principals (matches evaluator audience)',
    async (attribute) => {
      await getAttributeValueSuggestions(attribute, '', 20)
      expect(capturedSql).toContain('principal p')
      expect(capturedSql).toContain('p.user_id = u.id')
      expect(capturedSql).toContain("p.role = 'user'")
    }
  )

  it.each(['country', 'locale', 'name', 'email', 'signup_source'] as const)(
    'orders %s by count DESC so most-common values surface first',
    async (attribute) => {
      await getAttributeValueSuggestions(attribute, '', 20)
      expect(capturedSql).toContain('ORDER BY count DESC')
    }
  )

  it.each(['country', 'locale', 'name', 'email', 'signup_source'] as const)(
    'caps %s row count via LIMIT',
    async (attribute) => {
      await getAttributeValueSuggestions(attribute, '', 20)
      expect(capturedSql).toContain('LIMIT 20')
    }
  )
})

describe('getAttributeValueSuggestions — country', () => {
  it('uppercases the query so admin typing "us" matches stored "US"', async () => {
    await getAttributeValueSuggestions('country', 'us', 20)
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('US%')
    // Lowercase must not leak through to the predicate.
    expect(capturedSql).not.toMatch(/ILIKE 'us%'/)
  })

  it('omits the ILIKE filter when query is empty', async () => {
    await getAttributeValueSuggestions('country', '', 20)
    expect(capturedSql).toContain('u.country IS NOT NULL')
    expect(capturedSql).not.toContain('ILIKE')
  })
})

describe('getAttributeValueSuggestions — locale', () => {
  it('prefix-filters on u.locale when query is present', async () => {
    await getAttributeValueSuggestions('locale', 'en', 20)
    expect(capturedSql).toContain('u.locale')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('en%')
  })
})

describe('getAttributeValueSuggestions — name', () => {
  it('excludes empty name strings (defensive against bad source data)', async () => {
    await getAttributeValueSuggestions('name', '', 20)
    expect(capturedSql).toContain("u.name <> ''")
  })
})

describe('getAttributeValueSuggestions — email', () => {
  it('filters out users whose email is NULL', async () => {
    await getAttributeValueSuggestions('email', '', 20)
    expect(capturedSql).toContain('u.email IS NOT NULL')
  })
})

describe('getAttributeValueSuggestions — signup_source', () => {
  it('derives source via COALESCE on oldest account.provider_id with email fallback', async () => {
    await getAttributeValueSuggestions('signup_source', '', 20)
    expect(capturedSql).toContain('COALESCE')
    expect(capturedSql).toContain('account a')
    expect(capturedSql).toContain('a.user_id = u.id')
    expect(capturedSql).toContain('ORDER BY a.created_at ASC LIMIT 1')
    expect(capturedSql).toContain("'email'")
  })

  it('applies prefix filter to the derived expression, not a plain column', async () => {
    // The filter must wrap the COALESCE expression — filtering only the
    // raw account.provider_id would miss the magic-link "email" cohort.
    await getAttributeValueSuggestions('signup_source', 'goo', 20)
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('goo%')
    expect(capturedSql).toContain('COALESCE')
  })
})

describe('getAttributeValueSuggestions — return shape', () => {
  it('maps DB rows to {value, count}', async () => {
    const { db } = await import('@/lib/server/db')
    ;(db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { value: 'US', count: 23 },
      { value: 'GB', count: 5 },
    ])
    const result = await getAttributeValueSuggestions('country', '', 20)
    expect(result).toEqual([
      { value: 'US', count: 23 },
      { value: 'GB', count: 5 },
    ])
  })
})
