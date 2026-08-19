/**
 * Evaluator coverage for the company predicates (§K3): company_plan,
 * company_mrr, company_size, company_industry, and company_attr (custom
 * attributes), all resolved through principal.company_id -> companies.
 *
 * Same SQL-capture approach as segment-evaluation-builtin.test.ts: mock
 * @/lib/server/db so db.execute captures the generated SQL text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// -----------------------------------------------------------------------
// Captured SQL storage
// -----------------------------------------------------------------------

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

vi.mock('@/lib/server/db', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      execute: vi.fn(async (sqlObj: SqlObj) => {
        capturedSql = sqlObj.text
        return []
      }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(async () => {}),
        })),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        await fn({
          insert: vi.fn(() => ({
            values: vi.fn(() => ({
              onConflictDoNothing: vi.fn(async () => {}),
            })),
          })),
          delete: vi.fn(() => ({
            where: vi.fn(async () => {}),
          })),
        })
      }),
    },
    eq: vi.fn((a: unknown, b: unknown) => ({ __cond: 'eq', a, b })),
    and: vi.fn((...args: unknown[]) => ({ __cond: 'and', args })),
    inArray: vi.fn((col: unknown, vals: unknown[]) => ({ __cond: 'in', col, vals })),
    isNull: vi.fn((col: unknown) => ({ __cond: 'isNull', col })),
    sql: makeSql,
  }
})

type MockCondition = {
  attribute: string
  operator: string
  value?: string | number | boolean | string[]
  metadataKey?: string
}

type MockSegment = {
  id: string
  name: string
  type: string
  rules: {
    match: 'all' | 'any'
    conditions: MockCondition[]
  } | null
}
let mockSegment: MockSegment | null = null

vi.mock('../segment.service', () => ({
  getSegment: vi.fn(async () => mockSegment),
}))

vi.mock('@/lib/server/integrations/user-sync-notify', () => ({
  notifyUserSyncIntegrations: vi.fn(async () => {}),
}))

vi.mock('@quackback/ids', () => ({
  fromUuid: vi.fn((_prefix: string, id: string) => id),
}))

import { evaluateDynamicSegment } from '../segment.evaluation'

function makeSegment(conditions: MockCondition[]): MockSegment {
  return {
    id: 'segment_test',
    name: 'Test Segment',
    type: 'dynamic',
    rules: { match: 'all', conditions },
  }
}

beforeEach(() => {
  capturedSql = ''
  mockSegment = null
  vi.clearAllMocks()
})

describe('evaluator — company join', () => {
  it('resolves company predicates through principal.company_id', async () => {
    mockSegment = makeSegment([{ attribute: 'company_plan', operator: 'eq', value: 'Scale' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('LEFT JOIN companies co ON co.id = p.company_id')
  })
})

describe('evaluator — company_plan attribute', () => {
  it('eq operator produces co.plan = value', async () => {
    mockSegment = makeSegment([{ attribute: 'company_plan', operator: 'eq', value: 'Scale' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.plan')
    expect(capturedSql).toContain('=')
    expect(capturedSql).toContain('Scale')
  })

  it('contains operator produces co.plan ILIKE %value%', async () => {
    mockSegment = makeSegment([{ attribute: 'company_plan', operator: 'contains', value: 'ent' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.plan')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('%ent%')
  })

  it('neq is NULL-safe: people with no company (or no plan) satisfy it', async () => {
    mockSegment = makeSegment([{ attribute: 'company_plan', operator: 'neq', value: 'Free' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.plan IS NULL OR')
    expect(capturedSql).toContain('!=')
  })

  it('in operator produces co.plan IN (values)', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_plan', operator: 'in', value: ['Scale', 'Enterprise'] },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.plan')
    expect(capturedSql).toContain('IN')
    expect(capturedSql).toContain('Enterprise')
  })

  it('is_set / is_not_set check plan presence', async () => {
    mockSegment = makeSegment([{ attribute: 'company_plan', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.plan IS NOT NULL')

    mockSegment = makeSegment([{ attribute: 'company_plan', operator: 'is_not_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.plan IS NULL')
  })
})

describe('evaluator — company_mrr attribute (monthly spend, whole units)', () => {
  it('compares against mrr_cents scaled to whole currency units', async () => {
    mockSegment = makeSegment([{ attribute: 'company_mrr', operator: 'gte', value: 500 }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.mrr_cents / 100.0')
    expect(capturedSql).toContain('>=')
    expect(capturedSql).toContain('500')
  })

  it('is_set checks the column, not the scaled expression', async () => {
    mockSegment = makeSegment([{ attribute: 'company_mrr', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.mrr_cents IS NOT NULL')
  })

  it('rejects string operators (no ILIKE on a number)', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_mrr', operator: 'contains', value: '5' },
      // Second, supported condition so the query still runs.
      { attribute: 'company_plan', operator: 'eq', value: 'Scale' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).not.toContain('mrr_cents / 100.0) ILIKE')
  })
})

describe('evaluator — company_size and company_industry attributes', () => {
  it('company_size eq produces co.size = value', async () => {
    mockSegment = makeSegment([{ attribute: 'company_size', operator: 'eq', value: '11-50' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.size')
    expect(capturedSql).toContain('11-50')
  })

  it('company_industry contains produces co.industry ILIKE', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_industry', operator: 'contains', value: 'fin' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.industry')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('%fin%')
  })

  it('company_industry neq is NULL-safe', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_industry', operator: 'neq', value: 'Gambling' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('co.industry IS NULL OR')
  })
})

describe('evaluator — company_attr attribute (custom attributes)', () => {
  it('reads the metadataKey from the company jsonb blob', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_attr', operator: 'eq', value: 'eu', metadataKey: 'region' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain("co.custom_attributes::jsonb->>")
    expect(capturedSql).toContain('region')
    expect(capturedSql).toContain('eu')
  })

  it('numeric values compare with a ::numeric cast', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_attr', operator: 'gte', value: 50, metadataKey: 'seats' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('::numeric')
    expect(capturedSql).toContain('>=')
    expect(capturedSql).toContain('50')
  })

  it('is_set / is_not_set check key presence', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_attr', operator: 'is_set', metadataKey: 'region' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('IS NOT NULL')
    expect(capturedSql).toContain('region')
  })

  it('in operator matches any of the values', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_attr', operator: 'in', value: ['eu', 'us'], metadataKey: 'region' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('IN')
    expect(capturedSql).toContain('eu')
    expect(capturedSql).toContain('us')
  })

  it('a company_attr condition without a metadataKey is dropped', async () => {
    mockSegment = makeSegment([
      { attribute: 'company_attr', operator: 'eq', value: 'x' },
      { attribute: 'company_plan', operator: 'eq', value: 'Scale' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).not.toContain('custom_attributes')
    expect(capturedSql).toContain('co.plan')
  })
})
