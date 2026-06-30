/**
 * Tests for author resolution in feedback ingestion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

// --- Mock tracking ---
const mockSelect = vi.fn()
const mockInsertValues = vi.fn()
const mockFindFirstExternalMapping = vi.fn()

const mockWhereCalls: unknown[] = []
function createSelectChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn((cond: unknown) => {
    mockWhereCalls.push(cond)
    return chain
  })
  chain.limit = vi.fn().mockResolvedValue(rows)
  return chain
}

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  let inserted: unknown[] = []
  chain.values = vi.fn((...args: unknown[]) => {
    mockInsertValues(...args)
    inserted = Array.isArray(args[0]) ? (args[0] as unknown[]) : [args[0]]
    return chain
  })
  chain.onConflictDoNothing = vi.fn(() => chain)
  chain.returning = vi.fn(() => Promise.resolve(inserted))
  return chain
}

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: vi.fn(() => createInsertChain()),
    query: {
      externalUserMappings: {
        findFirst: (...args: unknown[]) => mockFindFirstExternalMapping(...args),
      },
    },
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
  // sql tagged template — the LOWER(email) lookup uses it. Return a
  // tagged marker so tests can assert it was used (instead of a raw
  // case-sensitive eq).
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    raw: strings.join(' '),
    values,
  })),
  user: { email: 'email' },
  principal: { id: 'principal_id', userId: 'user_id' },
  externalUserMappings: {},
}))

vi.mock('@quackback/ids', async () => {
  let counter = 0
  return {
    createId: vi.fn((prefix: string) => `${prefix}_${++counter}` as PrincipalId),
  }
})

// Import after mocks
const { resolveAuthorPrincipal } = await import('../author-resolver')

describe('resolveAuthorPrincipal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns pre_resolved when principalId is provided', async () => {
    const result = await resolveAuthorPrincipal({ principalId: 'principal_123' }, 'quackback')

    expect(result).toEqual({
      principalId: 'principal_123',
      method: 'pre_resolved',
    })
    // No DB calls should be made
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('resolves by email when user exists', async () => {
    mockSelect.mockReturnValue(createSelectChain([{ principalId: 'principal_existing' }]))

    const result = await resolveAuthorPrincipal(
      { email: 'alice@example.com', name: 'Alice' },
      'intercom'
    )

    expect(result).toEqual({
      principalId: 'principal_existing',
      method: 'email',
    })
  })

  it('creates new user when email not found', async () => {
    mockSelect.mockReturnValue(createSelectChain([]))

    const result = await resolveAuthorPrincipal(
      { email: 'new@example.com', name: 'New User' },
      'intercom'
    )

    expect(result.method).toBe('created_new')
    expect(result.principalId).toBeTruthy()
  })

  it('normalizes email to lowercase', async () => {
    mockSelect.mockReturnValue(createSelectChain([{ principalId: 'principal_existing' }]))

    await resolveAuthorPrincipal({ email: '  Alice@Example.COM  ' }, 'intercom')

    // The select chain was called, meaning email resolution was attempted
    expect(mockSelect).toHaveBeenCalled()
  })

  it('matches users whose stored email differs only in case (LOWER(email))', async () => {
    // Regression: the email-lookup used `eq(user.email, email)`. Users
    // signed up via Better-Auth with mixed-case emails (e.g.
    // 'Alice@example.com'); a follow-up feedback ingest with
    // 'alice@example.com' missed and created a duplicate user record.
    // The query must lower-fold both sides — the LOWER(user.email)
    // functional index (migration 0076) supports this without a seq
    // scan.
    mockWhereCalls.length = 0
    mockSelect.mockReturnValue(createSelectChain([{ principalId: 'principal_existing' }]))

    await resolveAuthorPrincipal({ email: 'alice@example.com' }, 'intercom')

    // The first where() call must be a sql LOWER(...) marker, not a
    // raw eq(user.email, ...). Case-sensitive eq would miss
    // `Alice@example.com` rows and silently create duplicate users.
    const firstCond = mockWhereCalls[0] as { kind?: string; raw?: string }
    expect(firstCond.kind).toBe('sql')
    expect(firstCond.raw?.toLowerCase()).toContain('lower(')
  })

  it('resolves by external ID when mapping exists', async () => {
    mockFindFirstExternalMapping.mockResolvedValue({
      principalId: 'principal_slack_user',
    })

    const result = await resolveAuthorPrincipal({ externalUserId: 'U12345' }, 'slack')

    expect(result).toEqual({
      principalId: 'principal_slack_user',
      method: 'external_id',
    })
  })

  it('creates new user for unknown external ID without email', async () => {
    mockFindFirstExternalMapping.mockResolvedValue(null)

    const result = await resolveAuthorPrincipal(
      { externalUserId: 'U99999', name: 'Slack User' },
      'slack'
    )

    expect(result.method).toBe('created_new')
    expect(result.principalId).toBeTruthy()
  })

  it('resolves external ID with email by checking email first', async () => {
    mockFindFirstExternalMapping.mockResolvedValue(null)
    // Email resolution finds existing user
    mockSelect.mockReturnValue(createSelectChain([{ principalId: 'principal_via_email' }]))

    const result = await resolveAuthorPrincipal(
      { externalUserId: 'U12345', email: 'existing@example.com', name: 'User' },
      'slack'
    )

    // Should use email resolution, not create new
    expect(result.principalId).toBe('principal_via_email')
    // Method should be email since the external mapping didn't exist but email matched
    expect(result.method).toBe('email')
  })

  it('returns unresolvable when no resolution info provided', async () => {
    const result = await resolveAuthorPrincipal({}, 'intercom')

    expect(result).toEqual({
      principalId: null,
      method: 'unresolvable',
    })
  })

  it('returns unresolvable when email is empty after trim', async () => {
    const result = await resolveAuthorPrincipal({ email: '   ' }, 'intercom')

    expect(result).toEqual({
      principalId: null,
      method: 'unresolvable',
    })
  })

  it('prefers principalId over email', async () => {
    const result = await resolveAuthorPrincipal(
      { principalId: 'principal_direct', email: 'also@example.com' },
      'quackback'
    )

    expect(result.method).toBe('pre_resolved')
    expect(result.principalId).toBe('principal_direct')
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('prefers email over external ID', async () => {
    mockSelect.mockReturnValue(createSelectChain([{ principalId: 'principal_email' }]))

    const result = await resolveAuthorPrincipal(
      { email: 'user@example.com', externalUserId: 'U12345' },
      'slack'
    )

    expect(result.method).toBe('email')
    expect(result.principalId).toBe('principal_email')
    // External mapping lookup should not be called
    expect(mockFindFirstExternalMapping).not.toHaveBeenCalled()
  })
})
