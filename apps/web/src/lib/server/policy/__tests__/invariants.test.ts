/**
 * Property-style invariants for the policy module.
 *
 * Two layers:
 *  1. Determinism + sanity invariants across the full (actor, audience) space
 *     for canViewBoard (in-memory truth table).
 *  2. SQL-shape inspection for boardViewFilter / postViewFilter —
 *     drizzle's `sql` template exposes `.toSQL()` which lets us assert
 *     the predicate composition without hitting Postgres. The full SQL
 *     execution is exercised in Task 22's integration test.
 */
import { describe, it, expect } from 'vitest'
import { canViewBoard, boardViewFilter } from '../boards'
import { postViewFilter } from '../posts'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { createId, type SegmentId, type PrincipalId } from '@quackback/ids'
import type { BoardAccess, AccessTier } from '@/lib/server/db'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// SQL-rendering tests need real TypeIDs because drizzle's column mapper
// runs toDriver() at render time. Logic-only tests (above) accept any
// branded string. Generate once at module load; values are stable.
const PRINCIPAL_USER = createId('principal') as PrincipalId
const PRINCIPAL_USER_ALPHA = createId('principal') as PrincipalId
const PRINCIPAL_USER_ALPHABETA = createId('principal') as PrincipalId
const PRINCIPAL_SERVICE = createId('principal') as PrincipalId
const PRINCIPAL_MEMBER = createId('principal') as PrincipalId
const PRINCIPAL_ADMIN = createId('principal') as PrincipalId
const SEGMENT_ALPHA = createId('segment') as SegmentId
const SEGMENT_BETA = createId('segment') as SegmentId

function buildActor(overrides: Partial<Actor>): Actor {
  return {
    principalId: null,
    role: null,
    principalType: 'anonymous',
    segmentIds: new Set(),
    ...overrides,
  }
}

const actors: Record<string, Actor> = {
  anon: ANONYMOUS_ACTOR,
  user: buildActor({ principalId: PRINCIPAL_USER, role: 'user', principalType: 'user' }),
  userInAlpha: buildActor({
    principalId: PRINCIPAL_USER_ALPHA,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA]),
  }),
  // Two memberships — exercises the multi-element ARRAY[$2, $3] render in
  // boardViewFilter (the exact sql.join path the ANY(()) fix rewrote).
  userInAlphaBeta: buildActor({
    principalId: PRINCIPAL_USER_ALPHABETA,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA, SEGMENT_BETA]),
  }),
  service: buildActor({
    principalId: PRINCIPAL_SERVICE,
    role: 'user',
    principalType: 'service',
  }),
  member: buildActor({ principalId: PRINCIPAL_MEMBER, role: 'member', principalType: 'user' }),
  admin: buildActor({ principalId: PRINCIPAL_ADMIN, role: 'admin', principalType: 'user' }),
}

// Equivalent BoardAccess shapes for each historical audience kind. Same
// tier on every action and approval off so the matrix mirrors the pre-T24
// `audienceToAccess` derivation. Useful for exercising canViewBoard /
// boardViewFilter across the full tier space.
function mkAccess(view: AccessTier, segmentIds: string[] = []): BoardAccess {
  return {
    view,
    vote: view,
    comment: view,
    submit: view,
    segments: {
      view: segmentIds,
      vote: segmentIds,
      comment: segmentIds,
      submit: segmentIds,
    },
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  }
}

const accesses: BoardAccess[] = [
  mkAccess('anonymous'),
  mkAccess('authenticated'),
  mkAccess('team'),
  mkAccess('segments', [SEGMENT_ALPHA]),
  mkAccess('segments', [SEGMENT_BETA]),
  mkAccess('segments', []),
]

describe('policy invariants — boards', () => {
  it('canViewBoard is deterministic across calls', () => {
    for (const actor of Object.values(actors)) {
      for (const access of accesses) {
        const a = canViewBoard(actor, { access })
        const b = canViewBoard(actor, { access })
        expect(a.allowed).toBe(b.allowed)
      }
    }
  })

  it('team (member/admin) always passes regardless of access tier', () => {
    for (const actor of [actors.member, actors.admin]) {
      for (const access of accesses) {
        expect(canViewBoard(actor, { access }).allowed).toBe(true)
      }
    }
  })

  it('anonymous only passes access.view === "anonymous"', () => {
    for (const access of accesses) {
      expect(canViewBoard(ANONYMOUS_ACTOR, { access }).allowed).toBe(access.view === 'anonymous')
    }
  })

  it('service principalType is denied by view="authenticated"', () => {
    expect(canViewBoard(actors.service, { access: mkAccess('authenticated') }).allowed).toBe(false)
  })

  it('segment view tier never admits a non-member non-team actor', () => {
    for (const access of accesses.filter((a) => a.view === 'segments')) {
      expect(canViewBoard(actors.user, { access }).allowed).toBe(false)
    }
  })

  it('access denials always carry a non-empty reason', () => {
    for (const access of accesses) {
      const decision = canViewBoard(ANONYMOUS_ACTOR, { access })
      if (!decision.allowed) {
        expect(decision.reason.length).toBeGreaterThan(0)
      }
    }
  })
})

// ----------------------------------------------------------------------
// SQL shape introspection
// ----------------------------------------------------------------------

// Resolve a drizzle SQL fragment to its rendered string + bound parameters
// without hitting Postgres. Uses the pg dialect's own sql-to-query renderer.
const dialect = new PgDialect()
function toQueryShape(fragment: SQL): { sql: string; params: unknown[] } {
  // PgDialect.sqlToQuery returns `Query` with `params: unknown[]` typed
  // by drizzle. Pass through directly.
  return dialect.sqlToQuery(fragment)
}

// H5 — structural SQL-validity guard. The policy `xFilter` functions hand-build
// SQL; a malformed fragment (e.g. an empty `ANY(())`) is a Postgres syntax
// error that string-shape tests do not catch. This validator rejects the
// known failure modes.
function assertValidFilterSql(rendered: string): void {
  if (rendered.trim().length === 0) {
    throw new Error('rendered SQL is empty')
  }
  // Targets the specific shipped bug shape — an immediately-empty paren pair
  // inside ANY(). It is not a general empty-set detector (e.g. ANY(ARRAY[])
  // would pass); full row-level verification is deferred to spec item G5.
  if (/ANY\(\s*\(\s*\)/.test(rendered)) {
    throw new Error(`empty ANY(()) in rendered SQL: ${rendered}`)
  }
  let depth = 0
  for (const ch of rendered) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth < 0) throw new Error(`unbalanced parens in rendered SQL: ${rendered}`)
  }
  if (depth !== 0) throw new Error(`unbalanced parens in rendered SQL: ${rendered}`)
}

describe('assertValidFilterSql helper', () => {
  it('rejects an empty ANY(()) construct', () => {
    expect(() => assertValidFilterSql(`seg = ANY(()::text[])`)).toThrow(/empty ANY/)
  })
  it('rejects unbalanced parentheses', () => {
    expect(() => assertValidFilterSql(`(a = b`)).toThrow(/unbalanced/)
  })
  it('rejects a close-before-open paren', () => {
    expect(() => assertValidFilterSql(`)a(`)).toThrow(/unbalanced/)
  })
  it('rejects empty SQL', () => {
    expect(() => assertValidFilterSql(`   `)).toThrow(/empty/)
  })
  it('accepts a well-formed fragment', () => {
    expect(() => assertValidFilterSql(`(a = ANY(ARRAY[$1]::text[]))`)).not.toThrow()
  })
})

describe('boardViewFilter — SQL shape', () => {
  it('team actor predicate filters soft-deleted boards', () => {
    // Team actors bypass the access-tier checks but must still see
    // `is null` on deletedAt — soft-deleted boards never surface
    // through the portal-facing reader paths.
    const { sql, params } = toQueryShape(boardViewFilter(actors.admin))
    expect(sql).toMatch(/deleted_at.*is null/i)
    expect(params).toEqual([])
  })

  it('anonymous actor predicate references access->>view and excludes the authenticated branch', () => {
    const { sql } = toQueryShape(boardViewFilter(ANONYMOUS_ACTOR))
    // Must check the anonymous view tier
    expect(sql).toMatch(/access.*'anonymous'/)
    // Must filter soft-deleted boards regardless of actor
    expect(sql).toMatch(/deleted_at.*is null/i)
    // The authenticated branch is gated by `isUser` (false for anon) — drizzle inlines the
    // literal false alongside the tier check, so the branch is structurally present but
    // never satisfied. The important property is that the JSON tier comparison is present.
    expect(sql).toMatch(/'authenticated'/)
    // The segments branch collapses to a constant `false` for an actor with
    // no memberships (anonymous always qualifies) — it can never match, so
    // the `'segments'` tier comparison is correctly absent.
    expect(sql).not.toMatch(/'segments'/)
  })

  it('portal-user actor binds memberIds as a parameter (anti SQL-injection)', () => {
    const { sql, params } = toQueryShape(boardViewFilter(actors.userInAlpha))
    // memberIds is interpolated. The exact binding shape varies by dialect
    // version (sometimes an array param, sometimes spread positional). The
    // invariant we care about: the segment id appears as a *parameter value*,
    // never inlined into the SQL string (which would be an injection vector).
    const flatParams = params.flat(2)
    expect(flatParams).toContain(SEGMENT_ALPHA)
    expect(sql).not.toContain(SEGMENT_ALPHA)
  })

  it('portal-user with no memberships does not produce a SQL fragment containing arbitrary text', () => {
    // Empty memberIds: drizzle still binds the array safely, just empty.
    const { sql, params } = toQueryShape(boardViewFilter(actors.user))
    // No bound parameter should appear in the SQL string literally.
    for (const p of params.flat(2)) {
      if (typeof p === 'string' && p.length > 5) {
        expect(sql).not.toContain(p)
      }
    }
  })

  it('anonymous (empty memberIds) never renders an empty ANY(()...) — invalid SQL', () => {
    // drizzle spreads a JS array in a `sql` template as comma-separated
    // params, so an empty array would render `ANY(()::text[])`, which
    // Postgres rejects. The segments branch must collapse to a constant
    // instead. Guards the public-portal-while-logged-out crash.
    const { sql } = toQueryShape(boardViewFilter(ANONYMOUS_ACTOR))
    expect(sql).not.toContain('ANY(()')
  })

  it('portal-user with memberships renders a proper ARRAY[...] for the segments check', () => {
    const { sql } = toQueryShape(boardViewFilter(actors.userInAlpha))
    expect(sql).toContain('ANY(ARRAY[')
    expect(sql).not.toContain('ANY(()')
  })

  it('predicate is stable across calls (same input → same SQL)', () => {
    const a = toQueryShape(boardViewFilter(actors.userInAlpha))
    const b = toQueryShape(boardViewFilter(actors.userInAlpha))
    expect(a.sql).toBe(b.sql)
    expect(a.params).toEqual(b.params)
  })
})

describe('view filters — structural SQL validity (H5)', () => {
  for (const [name, actor] of Object.entries(actors)) {
    it(`boardViewFilter renders structurally valid SQL for actor=${name}`, () => {
      assertValidFilterSql(toQueryShape(boardViewFilter(actor)).sql)
    })
    it(`postViewFilter renders structurally valid SQL for actor=${name}`, () => {
      assertValidFilterSql(toQueryShape(postViewFilter(actor)).sql)
    })
  }
})

describe('postViewFilter — SQL shape', () => {
  it('team actor predicate excludes only moderationState=deleted', () => {
    const { sql, params } = toQueryShape(postViewFilter(actors.admin))
    expect(sql).toMatch(/moderation_state/)
    // The team branch uses an inline sql`<> 'deleted'` template — drizzle
    // inlines the literal here (it's a hand-written sql tag, not `ne(...)`
    // which would bind it as a parameter). Either form is safe because the
    // literal is hard-coded, not user-supplied. Snapshot the SQL precisely.
    expect(sql).toContain("<> 'deleted'")
    expect(params).toEqual([])
  })

  it('non-team predicate references access AND moderation_state', () => {
    const { sql } = toQueryShape(postViewFilter(actors.user))
    expect(sql).toMatch(/access/)
    expect(sql).toMatch(/moderation_state/)
    // Both 'published' and 'pending' are bound as parameters (next test).
  })

  it('non-team predicate binds "published" and "pending" as parameters', () => {
    const { params } = toQueryShape(postViewFilter(actors.user))
    // Defense-in-depth: literal moderation states are bound via $N, not
    // inlined into the SQL string. The shape would be: $1='published',
    // $2='pending', plus principal_id and isUser bindings.
    expect(params).toContain('published')
    expect(params).toContain('pending')
  })

  it('non-team predicate maps principalId through typeid → uuid binding', () => {
    const { params } = toQueryShape(postViewFilter(actors.user))
    // The principal id is passed through the typeid column mapper, which
    // converts the TypeID string to its UUID component. We assert: exactly
    // one UUID-shaped param appears.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    const flat = params.flat(2).filter((p) => typeof p === 'string') as string[]
    const uuids = flat.filter((p) => uuidRe.test(p))
    expect(uuids).toHaveLength(1)
  })

  it('anonymous predicate has no principalId binding (no own-pending branch)', () => {
    const { params } = toQueryShape(postViewFilter(ANONYMOUS_ACTOR))
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    const flat = params.flat(2).filter((p) => typeof p === 'string') as string[]
    const uuids = flat.filter((p) => uuidRe.test(p))
    expect(uuids).toHaveLength(0)
  })

  it('anonymous predicate still requires moderation_state = published only', () => {
    const { sql, params } = toQueryShape(postViewFilter(ANONYMOUS_ACTOR))
    expect(sql).toMatch(/moderation_state/)
    expect(params).toContain('published')
    // 'pending' is NOT in the predicate for anonymous (no own-pending branch).
    expect(params).not.toContain('pending')
  })
})
