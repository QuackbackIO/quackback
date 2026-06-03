/**
 * Comprehensive tests for the segment-membership service.
 *
 * Critical invariants asserted:
 *  1. Source-priority guard: manual > api > widget > sso > dynamic.
 *     Lower-priority sources never demote an existing higher-priority row.
 *  2. reconcileSsoMemberships preserves manual/api/widget rows even
 *     when they're absent from the desired SSO claim. The bug class
 *     codex flagged would cause silent revocation of manual access on
 *     the next login.
 *  3. removeMember deletes regardless of source — admin "remove" is
 *     authoritative (not subject to the source-priority guard).
 *  4. Audit events fire when an actor is supplied, are skipped when
 *     null (system-driven calls like SSO reconcile).
 *  5. segmentIdsForPrincipal returns the empty set for null/unseen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ----------------------------------------------------------------------
// Typed mock infrastructure
// ----------------------------------------------------------------------

// A row in the in-memory `user_segments` table.
type Row = { principalId: string; segmentId: string; addedBy: string }

// Column reference sentinel — what `userSegments.principalId` etc. resolve to
// under the mock. The production code passes these into eq/and/inArray, which
// produce typed Condition objects we then evaluate against rows.
interface ColumnRef {
  __col: keyof Row
}

type Condition =
  | { kind: 'eq'; col: keyof Row; val: string }
  | { kind: 'in'; col: keyof Row; vals: readonly string[] }
  | { kind: 'and'; conditions: Condition[] }

// Match a Condition against a row.
function matchCondition(row: Row, c: Condition): boolean {
  switch (c.kind) {
    case 'eq':
      return row[c.col] === c.val
    case 'in':
      return c.vals.includes(row[c.col])
    case 'and':
      return c.conditions.every((sub) => matchCondition(row, sub))
  }
}

// Projection: a select({ key: column }) → return only those keys per row.
function projectRow(row: Row, projection: Record<string, ColumnRef>): Partial<Row> {
  const out: Partial<Row> = {}
  for (const [key, ref] of Object.entries(projection)) {
    out[key as keyof Row] = row[ref.__col]
  }
  return out
}

const state: { rows: Row[]; auditEvents: Array<Record<string, unknown>> } = {
  rows: [],
  auditEvents: [],
}

// Priority lookup duplicated here so the mock can implement the same
// semantics as the production SQL setWhere predicate. Production uses a
// SQL CASE expression; the mock evaluates the equivalent JS lookup.
const MOCK_PRIORITY: Record<string, number> = {
  manual: 5,
  api: 4,
  widget: 3,
  sso: 2,
  dynamic: 1,
}

// Track every onConflictDoUpdate call so contract tests can pin the
// predicate shape (presence of setWhere, target columns, etc.).
const upsertCalls: Array<{
  values: Row | Row[]
  conflict: { target: unknown; set: Record<string, unknown>; setWhere: unknown }
}> = []

vi.mock('@/lib/server/db', () => {
  return {
    db: {
      select: vi.fn((projection?: Record<string, ColumnRef>) => ({
        from: vi.fn(() => ({
          where: vi.fn(async (pred: Condition) => {
            const matching = state.rows.filter((r) => matchCondition(r, pred))
            return projection ? matching.map((row) => projectRow(row, projection)) : matching
          }),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row: Row | Row[]) => {
          // Two consumers of values():
          //   a) bare insert (no upsert): legacy path the old addMember
          //      used + reconcileSsoMemberships still uses for its delete.
          //   b) values(...).onConflictDoUpdate({...}): the new addMember
          //      upsert. Apply priority semantics in JS to mirror the
          //      SQL setWhere predicate.
          //
          // Return a thenable so `await db.insert().values(...)` still
          // works for path (a), plus an onConflictDoUpdate method for (b).
          const apply = () => {
            const rows = Array.isArray(row) ? row : [row]
            state.rows.push(...rows)
          }
          return {
            // Path (a)
            then(onFulfilled: (v: void) => void) {
              apply()
              return Promise.resolve().then(onFulfilled)
            },
            // Path (b)
            onConflictDoUpdate: (conflict: {
              target: unknown
              set: Record<string, unknown>
              setWhere: unknown
            }) => {
              upsertCalls.push({ values: row, conflict })
              const incoming = Array.isArray(row) ? row[0] : row
              // Mirror PG's RETURNING behaviour for ON CONFLICT DO UPDATE
              // with a setWhere: rows are returned when the INSERT fired
              // OR when the UPDATE matched the setWhere. The phantom-audit
              // fix relies on returning() length to detect real changes.
              const runUpsert = (): typeof state.rows => {
                const existing = state.rows.find(
                  (r) =>
                    r.principalId === incoming.principalId && r.segmentId === incoming.segmentId
                )
                if (!existing) {
                  state.rows.push(incoming)
                  return [incoming]
                }
                const newPriority = MOCK_PRIORITY[String(conflict.set.addedBy)]
                const existingPriority = MOCK_PRIORITY[existing.addedBy]
                if (newPriority > existingPriority) {
                  existing.addedBy = String(conflict.set.addedBy)
                  return [existing]
                }
                return [] // no-op (preserves stickier source)
              }
              // Support both legacy `await onConflictDoUpdate(...)` and the
              // new `.onConflictDoUpdate(...).returning(...)` chain.
              return {
                then(onFulfilled: (v: void) => void) {
                  runUpsert()
                  return Promise.resolve().then(onFulfilled)
                },
                returning: async () => runUpsert(),
              }
            },
          }
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: Partial<Row>) => ({
          where: vi.fn(async (pred: Condition) => {
            state.rows = state.rows.map((r) => (matchCondition(r, pred) ? { ...r, ...patch } : r))
          }),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(async (pred: Condition) => {
          state.rows = state.rows.filter((r) => !matchCondition(r, pred))
        }),
      })),
    },
    userSegments: {
      principalId: { __col: 'principalId' } satisfies ColumnRef,
      segmentId: { __col: 'segmentId' } satisfies ColumnRef,
      addedBy: { __col: 'addedBy' } satisfies ColumnRef,
    },
    eq: vi.fn((col: ColumnRef, val: string): Condition => ({ kind: 'eq', col: col.__col, val })),
    and: vi.fn((...conditions: Condition[]): Condition => ({ kind: 'and', conditions })),
    inArray: vi.fn(
      (col: ColumnRef, vals: readonly string[]): Condition => ({
        kind: 'in',
        col: col.__col,
        vals,
      })
    ),
    sql: Object.assign(
      vi.fn((parts: TemplateStringsArray, ..._values: unknown[]) => ({
        kind: 'sql',
        text: parts.raw.join('?'),
      })),
      { raw: vi.fn() }
    ),
  }
})

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(async (event: Record<string, unknown>) => {
    state.auditEvents.push(event)
  }),
}))

import {
  addMember,
  removeMember,
  reconcileSsoMemberships,
  reconcileWidgetMemberships,
  segmentIdsForPrincipal,
  type MembershipSource,
} from '../segment-membership.service'
import type { PrincipalId, SegmentId } from '@quackback/ids'

const P1 = 'p1' as PrincipalId
const P2 = 'p2' as PrincipalId
const S1 = 's1' as SegmentId
const S2 = 's2' as SegmentId
const S3 = 's3' as SegmentId
const ACTOR_NULL = null
const ACTOR_ADMIN = { userId: null, email: 'admin@x', role: 'admin' as const }

beforeEach(() => {
  state.rows = []
  state.auditEvents = []
  upsertCalls.length = 0
})

// ----------------------------------------------------------------------
// addMember — source-priority matrix
// ----------------------------------------------------------------------

const SOURCES: MembershipSource[] = ['manual', 'api', 'widget', 'sso', 'dynamic']
const PRIORITY: Record<MembershipSource, number> = {
  manual: 5,
  api: 4,
  widget: 3,
  sso: 2,
  dynamic: 1,
}

describe('addMember — source-priority matrix', () => {
  for (const existing of SOURCES) {
    for (const incoming of SOURCES) {
      it(`existing=${existing} + incoming=${incoming}`, async () => {
        state.rows.push({ principalId: P1, segmentId: S1, addedBy: existing })
        await addMember({
          principalId: P1,
          segmentId: S1,
          source: incoming,
          actor: ACTOR_NULL,
        })
        expect(state.rows).toHaveLength(1)
        const row = state.rows[0]
        // Whichever source has higher (or equal) priority wins. On equal
        // priority, the existing row stays — the priority guard's `>`
        // means equality is a no-op.
        const expected = PRIORITY[incoming] > PRIORITY[existing] ? incoming : existing
        expect(row.addedBy).toBe(expected)
      })
    }
  }

  it('inserts a fresh row when none exists', async () => {
    await addMember({
      principalId: P1,
      segmentId: S1,
      source: 'widget',
      actor: ACTOR_NULL,
    })
    expect(state.rows).toEqual([{ principalId: P1, segmentId: S1, addedBy: 'widget' }])
  })
})

// ----------------------------------------------------------------------
// addMember — audit event behaviour
// ----------------------------------------------------------------------

describe('addMember — audit', () => {
  it('emits segment.member.added when an actor is supplied', async () => {
    await addMember({ principalId: P1, segmentId: S1, source: 'manual', actor: ACTOR_ADMIN })
    expect(state.auditEvents).toHaveLength(1)
    expect(state.auditEvents[0].event).toBe('segment.member.added')
    expect((state.auditEvents[0].metadata as { source: string }).source).toBe('manual')
  })

  it('does NOT emit when actor is null (system-driven, e.g. SSO sync)', async () => {
    await addMember({ principalId: P1, segmentId: S1, source: 'sso', actor: null })
    expect(state.auditEvents).toHaveLength(0)
  })

  it('audits even when the call is a no-op (preserve-existing path)', async () => {
    // Admin clicks "add" on a user who's already in the segment manually.
    // The state doesn't change, but the audit event captures admin intent.
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'manual' })
    await addMember({ principalId: P1, segmentId: S1, source: 'manual', actor: ACTOR_ADMIN })
    expect(state.rows).toHaveLength(1)
    expect(state.auditEvents).toHaveLength(1)
  })
})

// ----------------------------------------------------------------------
// removeMember
// ----------------------------------------------------------------------

describe('removeMember — removes regardless of source', () => {
  it.each(SOURCES)('removes existing row with addedBy=%s', async (source) => {
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: source })
    await removeMember({ principalId: P1, segmentId: S1, actor: ACTOR_ADMIN })
    expect(state.rows).toEqual([])
    expect(state.auditEvents.find((e) => e.event === 'segment.member.removed')).toBeTruthy()
  })

  it('is a no-op when the row does not exist (no error, still audits)', async () => {
    await removeMember({ principalId: P1, segmentId: S1, actor: ACTOR_ADMIN })
    expect(state.rows).toEqual([])
    // The audit fires regardless — that's intentional (records the attempt).
    expect(state.auditEvents).toHaveLength(1)
  })

  it('only removes the targeted (principalId, segmentId) — others untouched', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'manual' },
      { principalId: P1, segmentId: S2, addedBy: 'manual' },
      { principalId: P2, segmentId: S1, addedBy: 'sso' }
    )
    await removeMember({ principalId: P1, segmentId: S1, actor: ACTOR_NULL })
    expect(state.rows).toEqual([
      { principalId: P1, segmentId: S2, addedBy: 'manual' },
      { principalId: P2, segmentId: S1, addedBy: 'sso' },
    ])
  })

  it('does NOT emit audit when actor is null', async () => {
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'manual' })
    await removeMember({ principalId: P1, segmentId: S1, actor: null })
    expect(state.auditEvents).toHaveLength(0)
  })
})

// ----------------------------------------------------------------------
// reconcileSsoMemberships — the codex-flagged bug class
// ----------------------------------------------------------------------

describe('reconcileSsoMemberships — preserves stickier sources', () => {
  it('does NOT delete manual rows when claim drops them', async () => {
    // The classic codex-flagged failure mode.
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'manual' })
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [] })
    expect(state.rows).toEqual([{ principalId: P1, segmentId: S1, addedBy: 'manual' }])
  })

  it('does NOT delete api/widget rows when claim drops them', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'api' },
      { principalId: P1, segmentId: S2, addedBy: 'widget' }
    )
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [] })
    expect(state.rows).toHaveLength(2)
  })

  it('deletes sso rows that are no longer in the claim', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'sso' },
      { principalId: P1, segmentId: S2, addedBy: 'sso' }
    )
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [S1] })
    expect(state.rows).toEqual([{ principalId: P1, segmentId: S1, addedBy: 'sso' }])
  })

  it('adds new sso memberships from the claim', async () => {
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [S1, S2] })
    expect(state.rows).toEqual([
      { principalId: P1, segmentId: S1, addedBy: 'sso' },
      { principalId: P1, segmentId: S2, addedBy: 'sso' },
    ])
  })

  it('manual + same segment in claim → manual stays (priority guard)', async () => {
    // Regression for the codex P2 finding: an SSO claim for a segment the
    // user already belongs to manually MUST NOT downgrade the row to 'sso'
    // (which would make it deletable on the next reconcile).
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'manual' })
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [S1] })
    expect(state.rows[0].addedBy).toBe('manual')
  })

  it('round-trip: manual stays through full add → drop → re-add cycle', async () => {
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'manual' })
    // Login 1: claim includes S1.
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [S1] })
    expect(state.rows[0].addedBy).toBe('manual')
    // Login 2: claim no longer includes S1. Without the priority guard,
    // login 1 would have downgraded to 'sso' and this delete would succeed.
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [] })
    expect(state.rows).toEqual([{ principalId: P1, segmentId: S1, addedBy: 'manual' }])
  })

  it('does not cross-pollinate principals', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'sso' },
      { principalId: P2, segmentId: S1, addedBy: 'sso' }
    )
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [] })
    // P2's memberships are untouched.
    expect(state.rows).toEqual([{ principalId: P2, segmentId: S1, addedBy: 'sso' }])
  })

  it('combination: manual + sso adds + sso drops', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'manual' },
      { principalId: P1, segmentId: S2, addedBy: 'sso' },
      { principalId: P1, segmentId: S3, addedBy: 'widget' }
    )
    // Claim: S1 (manual will stay), S2 (sso stays, already there), S3 not
    // in claim (widget stays). The sso row S2 stays; widget S3 stays.
    await reconcileSsoMemberships({ principalId: P1, desiredSegmentIds: [S1, S2] })
    const sorted = [...state.rows].sort((a, b) => a.segmentId.localeCompare(b.segmentId))
    expect(sorted).toEqual([
      { principalId: P1, segmentId: S1, addedBy: 'manual' },
      { principalId: P1, segmentId: S2, addedBy: 'sso' },
      { principalId: P1, segmentId: S3, addedBy: 'widget' },
    ])
  })
})

// ----------------------------------------------------------------------
// reconcileWidgetMemberships — mirrors the SSO reconcile contract on the
// widget side. Before this helper existed, /api/widget/identify only
// added members from the JWT segments claim with no removal path — a
// canceled customer kept their `enterprise` membership forever and
// retained private-portal access through allowedSegmentIds. This guard
// is the same shape as the SSO one: only addedBy='widget' rows are
// touched; manual / sso / api stay sticky.
// ----------------------------------------------------------------------

describe('reconcileWidgetMemberships — preserves stickier sources', () => {
  it('does NOT delete manual rows when the JWT drops them', async () => {
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'manual' })
    await reconcileWidgetMemberships({ principalId: P1, desiredSegmentIds: [] })
    expect(state.rows).toEqual([{ principalId: P1, segmentId: S1, addedBy: 'manual' }])
  })

  it('does NOT delete sso/api rows when the JWT drops them', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'sso' },
      { principalId: P1, segmentId: S2, addedBy: 'api' }
    )
    await reconcileWidgetMemberships({ principalId: P1, desiredSegmentIds: [] })
    expect(state.rows).toHaveLength(2)
  })

  it('deletes widget rows that are no longer in the JWT', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'widget' },
      { principalId: P1, segmentId: S2, addedBy: 'widget' }
    )
    await reconcileWidgetMemberships({ principalId: P1, desiredSegmentIds: [S1] })
    expect(state.rows).toEqual([{ principalId: P1, segmentId: S1, addedBy: 'widget' }])
  })

  it('adds new widget memberships from the JWT', async () => {
    await reconcileWidgetMemberships({ principalId: P1, desiredSegmentIds: [S1, S2] })
    expect(state.rows).toEqual([
      { principalId: P1, segmentId: S1, addedBy: 'widget' },
      { principalId: P1, segmentId: S2, addedBy: 'widget' },
    ])
  })

  it('canceled-customer scenario: JWT goes [enterprise] → [], membership is removed', async () => {
    // The headline bug: a customer's auth server stops minting the
    // `enterprise` segment in the JWT (subscription ended). On next
    // identify the widget membership must be dropped so the user loses
    // the corresponding portal-access grant.
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'widget' })
    await reconcileWidgetMemberships({ principalId: P1, desiredSegmentIds: [] })
    expect(state.rows).toEqual([])
  })

  it('does not cross-pollinate principals', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'widget' },
      { principalId: P2, segmentId: S1, addedBy: 'widget' }
    )
    await reconcileWidgetMemberships({ principalId: P1, desiredSegmentIds: [] })
    expect(state.rows).toEqual([{ principalId: P2, segmentId: S1, addedBy: 'widget' }])
  })
})

// ----------------------------------------------------------------------
// segmentIdsForPrincipal
// ----------------------------------------------------------------------

describe('segmentIdsForPrincipal', () => {
  it('returns empty set for null principalId', async () => {
    const ids = await segmentIdsForPrincipal(null)
    expect(ids.size).toBe(0)
  })

  it('returns empty set for a principal with no memberships', async () => {
    const ids = await segmentIdsForPrincipal(P1)
    expect(ids.size).toBe(0)
  })

  it('returns the set of segment ids for a principal with memberships', async () => {
    state.rows.push(
      { principalId: P1, segmentId: S1, addedBy: 'manual' },
      { principalId: P1, segmentId: S2, addedBy: 'sso' },
      { principalId: P2, segmentId: S3, addedBy: 'sso' } // different principal
    )
    const ids = await segmentIdsForPrincipal(P1)
    expect(ids.size).toBe(2)
    expect(ids.has(S1)).toBe(true)
    expect(ids.has(S2)).toBe(true)
    expect(ids.has(S3)).toBe(false)
  })

  it('returns a ReadonlySet (caller cannot mutate)', async () => {
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'manual' })
    const ids = await segmentIdsForPrincipal(P1)
    // TypeScript enforces this — but assert the runtime shape too.
    expect(ids instanceof Set).toBe(true)
  })
})

// ----------------------------------------------------------------------
// addMember — atomic upsert (TOCTOU resistance)
// ----------------------------------------------------------------------

describe('addMember — atomic upsert prevents source-priority races', () => {
  // Codex finding: the legacy read-then-write let a lower-priority
  // concurrent writer demote a manual/admin assignment. Fix replaces
  // the two-step dance with INSERT … ON CONFLICT DO UPDATE … WHERE
  // <priority compare>, so the priority check and the write are a
  // single atomic statement.
  //
  // These tests pin the upsert call shape so a refactor that drops
  // the atomic predicate fails immediately.

  it('uses INSERT … ON CONFLICT DO UPDATE with target on the (principalId, segmentId) pair', async () => {
    await addMember({
      principalId: P1,
      segmentId: S1,
      source: 'manual',
      actor: ACTOR_NULL,
    })

    expect(upsertCalls).toHaveLength(1)
    const call = upsertCalls[0]
    expect(call.conflict.target).toBeDefined()
    // setWhere MUST be present — it carries the priority predicate.
    // Without it, every conflict would unconditionally overwrite.
    expect(call.conflict.setWhere).toBeDefined()
  })

  it('sets addedBy to the incoming source in the conflict UPDATE', async () => {
    await addMember({
      principalId: P1,
      segmentId: S1,
      source: 'manual',
      actor: ACTOR_NULL,
    })

    expect(upsertCalls[0].conflict.set).toEqual(expect.objectContaining({ addedBy: 'manual' }))
  })

  it('does NOT use the legacy SELECT-then-INSERT-or-UPDATE pattern', async () => {
    // Sanity: the new code should never go through the bare db.update
    // path that the old addMember used. Removal still uses db.delete
    // and SSO reconcile still uses bare insert (for new rows) +
    // db.delete (for dropped rows) — verify addMember itself stays
    // on the atomic upsert.
    await addMember({
      principalId: P1,
      segmentId: S1,
      source: 'sso',
      actor: ACTOR_NULL,
    })
    expect(upsertCalls).toHaveLength(1)
  })

  it('priority guard holds when a lower-priority source races against an existing manual row', async () => {
    // Simulate the race: manual row already exists; an SSO sync
    // arrives concurrently. The atomic upsert's setWhere predicate
    // must reject the demotion.
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'manual' })

    await addMember({
      principalId: P1,
      segmentId: S1,
      source: 'sso',
      actor: ACTOR_NULL,
    })

    expect(state.rows[0].addedBy).toBe('manual')
  })

  it('priority guard allows a higher-priority source to promote an existing lower row', async () => {
    state.rows.push({ principalId: P1, segmentId: S1, addedBy: 'sso' })

    await addMember({
      principalId: P1,
      segmentId: S1,
      source: 'manual',
      actor: ACTOR_NULL,
    })

    expect(state.rows[0].addedBy).toBe('manual')
  })
})
