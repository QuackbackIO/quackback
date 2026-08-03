/**
 * Tests for the new built-in field evaluator cases:
 * name, principal_type.
 *
 * Uses the same SQL-capture approach as the existing evaluator tests:
 * mock @/lib/server/db so that db.execute captures the generated SQL
 * string, then assert on the normalized query text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// -----------------------------------------------------------------------
// Captured SQL storage
// -----------------------------------------------------------------------

let capturedSql = ''

// -----------------------------------------------------------------------
// The `sql` tag mock: builds a simple object whose `.toString()` and
// flattenSql() reconstitute the interpolated query text.
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Mock @/lib/server/db
// -----------------------------------------------------------------------

vi.mock('@/lib/server/db', () => {
  return {
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
    segments: {
      id: 'id',
      type: 'type',
      deletedAt: 'deleted_at',
    },
    userSegments: {
      segmentId: 'segment_id',
      principalId: 'principal_id',
      addedBy: 'added_by',
    },
  }
})

// -----------------------------------------------------------------------
// Mock getSegment (used by evaluateDynamicSegment)
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

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

describe('evaluator — name attribute', () => {
  it('eq operator produces u.name = value', async () => {
    mockSegment = makeSegment([{ attribute: 'name', operator: 'eq', value: 'Alice' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.name')
    expect(capturedSql).toContain('=')
    expect(capturedSql).toContain('Alice')
  })

  it('contains operator produces u.name ILIKE %value%', async () => {
    mockSegment = makeSegment([{ attribute: 'name', operator: 'contains', value: 'ali' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.name')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('%ali%')
  })

  it('is_set on name produces TRUE (name is NOT NULL)', async () => {
    mockSegment = makeSegment([{ attribute: 'name', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    // name is a NOT NULL column — is_set is always true; evaluator emits TRUE
    expect(capturedSql).toContain('TRUE')
  })

  it('is_not_set on name produces FALSE (name is NOT NULL)', async () => {
    mockSegment = makeSegment([{ attribute: 'name', operator: 'is_not_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    // name is a NOT NULL column — is_not_set is never true; evaluator emits FALSE
    expect(capturedSql).toContain('FALSE')
  })
})

describe('evaluator — principal_type attribute', () => {
  it('eq operator produces p.type = value', async () => {
    mockSegment = makeSegment([{ attribute: 'principal_type', operator: 'eq', value: 'user' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('p.type')
    expect(capturedSql).toContain('=')
    expect(capturedSql).toContain('user')
  })

  it('neq operator produces p.type != value', async () => {
    mockSegment = makeSegment([
      { attribute: 'principal_type', operator: 'neq', value: 'anonymous' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('p.type')
    expect(capturedSql).toContain('!=')
    expect(capturedSql).toContain('anonymous')
  })

  it('in operator produces p.type IN (values)', async () => {
    mockSegment = makeSegment([
      { attribute: 'principal_type', operator: 'in', value: ['user', 'anonymous'] },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('p.type')
    expect(capturedSql).toContain('IN')
    expect(capturedSql).toContain('user')
    expect(capturedSql).toContain('anonymous')
  })

  it('is_set on principal_type produces TRUE (always-present field)', async () => {
    mockSegment = makeSegment([{ attribute: 'principal_type', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('TRUE')
  })

  it('is_not_set on principal_type produces FALSE (always-present field)', async () => {
    mockSegment = makeSegment([{ attribute: 'principal_type', operator: 'is_not_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('FALSE')
  })
})

describe('evaluator — linked CRM attributes', () => {
  it('organization_domain matches through contact_user_links and active organizations', async () => {
    mockSegment = makeSegment([
      { attribute: 'organization_domain', operator: 'eq', value: 'ACME.COM' },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('FROM principal p')
    expect(capturedSql).toContain('INNER JOIN "user" u ON u.id = p.user_id')
    expect(capturedSql).toContain('contact_user_links cul')
    expect(capturedSql).toContain('cul.user_id = u.id')
    expect(capturedSql).toContain('organizations o')
    expect(capturedSql).toContain('o.archived_at IS NULL')
    expect(capturedSql).toContain('LOWER(o.domain)')
    expect(capturedSql).toContain('acme.com')
  })

  it('contact_title presence requires a linked contact', async () => {
    mockSegment = makeSegment([{ attribute: 'contact_title', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('contact_user_links cul')
    expect(capturedSql).toContain('contacts c')
    expect(capturedSql).toContain('c.archived_at IS NULL')
    expect(capturedSql).toContain('c.title IS NOT NULL')
  })

  it('contact metadata predicates use the selected metadata key on linked contacts', async () => {
    mockSegment = makeSegment([
      {
        attribute: 'contact_metadata_key',
        operator: 'contains',
        value: 'enterprise',
        metadataKey: 'tier',
      },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('contact_user_links cul')
    expect(capturedSql).toContain('c.metadata::jsonb->>tier')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('%enterprise%')
  })
})

describe('evaluator — locale attribute (nullable string from OIDC)', () => {
  it('eq operator produces u.locale = value', async () => {
    mockSegment = makeSegment([{ attribute: 'locale', operator: 'eq', value: 'en-US' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.locale')
    expect(capturedSql).toContain('=')
    expect(capturedSql).toContain('en-US')
  })

  it('contains operator produces u.locale ILIKE %value%', async () => {
    mockSegment = makeSegment([{ attribute: 'locale', operator: 'contains', value: 'en' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.locale')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('%en%')
  })

  it('in operator produces u.locale IN (values)', async () => {
    mockSegment = makeSegment([
      { attribute: 'locale', operator: 'in', value: ['en', 'en-US', 'en-GB'] },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.locale')
    expect(capturedSql).toContain('IN')
    expect(capturedSql).toContain('en-US')
  })

  it('is_set produces u.locale IS NOT NULL (nullable column — distinguishes signed-in-with-SSO)', async () => {
    mockSegment = makeSegment([{ attribute: 'locale', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.locale')
    expect(capturedSql).toContain('IS NOT NULL')
  })

  it('is_not_set produces u.locale IS NULL', async () => {
    mockSegment = makeSegment([{ attribute: 'locale', operator: 'is_not_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.locale')
    expect(capturedSql).toContain('IS NULL')
  })
})

describe('evaluator — country attribute (ISO-3166 alpha-2)', () => {
  it('eq operator uppercases the comparand so "us" matches the stored "US"', async () => {
    mockSegment = makeSegment([{ attribute: 'country', operator: 'eq', value: 'us' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.country')
    expect(capturedSql).toContain('=')
    expect(capturedSql).toContain('US')
    // Lowercase value must NOT leak through.
    expect(capturedSql).not.toContain(' us')
  })

  it('in operator uppercases each candidate code', async () => {
    mockSegment = makeSegment([{ attribute: 'country', operator: 'in', value: ['us', 'gb', 'de'] }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.country')
    expect(capturedSql).toContain('IN')
    expect(capturedSql).toContain('US')
    expect(capturedSql).toContain('GB')
    expect(capturedSql).toContain('DE')
  })

  it('is_set produces u.country IS NOT NULL', async () => {
    mockSegment = makeSegment([{ attribute: 'country', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.country')
    expect(capturedSql).toContain('IS NOT NULL')
  })

  it('is_not_set produces u.country IS NULL', async () => {
    mockSegment = makeSegment([{ attribute: 'country', operator: 'is_not_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.country')
    expect(capturedSql).toContain('IS NULL')
  })
})

describe('evaluator — last_active_days_ago attribute (derived from session)', () => {
  it('uses MAX(updated_at, created_at) so refreshed sessions count as active', async () => {
    // Regression: previously the comparison was against MAX(s.created_at)
    // alone. Better Auth refreshes sessions on activity by bumping
    // updated_at, leaving created_at frozen at sign-in — so a long-lived
    // active session looked stale (created weeks ago, even though the
    // user was actively browsing). COALESCE(updated_at, created_at)
    // recovers the intended "last active" semantics; created_at is the
    // fallback for older rows that pre-date the updated_at bump.
    mockSegment = makeSegment([{ attribute: 'last_active_days_ago', operator: 'gt', value: 30 }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('EXTRACT(EPOCH FROM')
    expect(capturedSql).toContain('s.updated_at')
    expect(capturedSql).toContain('s.created_at')
    expect(capturedSql).toContain('COALESCE')
    expect(capturedSql).toContain('session s')
    expect(capturedSql).toContain('s.user_id = u.id')
    expect(capturedSql).toContain('86400')
    expect(capturedSql).toContain('>')
    expect(capturedSql).toContain('30')
  })

  it('lte operator emits <=', async () => {
    mockSegment = makeSegment([{ attribute: 'last_active_days_ago', operator: 'lte', value: 7 }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('<=')
    expect(capturedSql).toContain('7')
  })

  it('is_set checks session existence (has ever signed in)', async () => {
    mockSegment = makeSegment([{ attribute: 'last_active_days_ago', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('EXISTS')
    expect(capturedSql).toContain('session s')
    expect(capturedSql).toContain('s.user_id = u.id')
    expect(capturedSql).not.toContain('NOT EXISTS')
  })

  it('is_not_set checks no-session (has never signed in)', async () => {
    mockSegment = makeSegment([{ attribute: 'last_active_days_ago', operator: 'is_not_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('NOT EXISTS')
    expect(capturedSql).toContain('session s')
  })
})

describe('evaluator — signup_source attribute (derived from account.providerId)', () => {
  it('eq operator COALESCEs missing-account users to "email"', async () => {
    mockSegment = makeSegment([{ attribute: 'signup_source', operator: 'eq', value: 'google' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('COALESCE')
    expect(capturedSql).toContain('account a')
    expect(capturedSql).toContain('a.user_id = u.id')
    expect(capturedSql).toContain("'email'") // fallback string
    expect(capturedSql).toContain('=')
    expect(capturedSql).toContain('google')
  })

  it('in operator allows multiple providers', async () => {
    mockSegment = makeSegment([
      { attribute: 'signup_source', operator: 'in', value: ['google', 'github', 'sso'] },
    ])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('COALESCE')
    expect(capturedSql).toContain('IN')
    expect(capturedSql).toContain('google')
    expect(capturedSql).toContain('github')
    expect(capturedSql).toContain('sso')
  })

  it('is_set produces TRUE (signup_source always resolves via COALESCE)', async () => {
    mockSegment = makeSegment([{ attribute: 'signup_source', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('TRUE')
  })

  it('is_not_set produces FALSE', async () => {
    mockSegment = makeSegment([{ attribute: 'signup_source', operator: 'is_not_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('FALSE')
  })
})

describe('evaluator — email attribute (full address matching)', () => {
  it('eq operator produces u.email = value', async () => {
    mockSegment = makeSegment([{ attribute: 'email', operator: 'eq', value: 'alice@example.com' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.email')
    expect(capturedSql).toContain('=')
    expect(capturedSql).toContain('alice@example.com')
  })

  it('contains operator produces u.email ILIKE %value%', async () => {
    mockSegment = makeSegment([{ attribute: 'email', operator: 'contains', value: 'acme' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.email')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('%acme%')
  })

  it('starts_with operator produces u.email ILIKE value%', async () => {
    mockSegment = makeSegment([{ attribute: 'email', operator: 'starts_with', value: 'admin' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.email')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('admin%')
  })

  it('ends_with operator produces u.email ILIKE %value', async () => {
    mockSegment = makeSegment([{ attribute: 'email', operator: 'ends_with', value: '@acme.com' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.email')
    expect(capturedSql).toContain('ILIKE')
    expect(capturedSql).toContain('%@acme.com')
  })

  it('is_set produces u.email IS NOT NULL', async () => {
    mockSegment = makeSegment([{ attribute: 'email', operator: 'is_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.email')
    expect(capturedSql).toContain('IS NOT NULL')
  })

  it('is_not_set produces u.email IS NULL', async () => {
    mockSegment = makeSegment([{ attribute: 'email', operator: 'is_not_set' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('u.email')
    expect(capturedSql).toContain('IS NULL')
  })
})
