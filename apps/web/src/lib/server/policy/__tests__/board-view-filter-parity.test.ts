/**
 * Execution-level parity test: boardViewFilter (SQL) ↔ canViewBoard (in-memory).
 *
 * The existing invariants test (invariants.test.ts) proves structural
 * validity of the rendered SQL — no empty ANY(()), balanced parens,
 * memberIds bound as parameters — but it does NOT prove that the SQL,
 * when executed by Postgres, admits the same rows that canViewBoard
 * would admit in memory.
 *
 * A future refactor could split the two predicates apart (e.g. by
 * changing how the JSONB `segments.view` array is matched, or by adding
 * a new tier to canViewBoard without updating the SQL) and ship a
 * subtle list-vs-detail visibility drift that no current test catches.
 *
 * This test pins that invariant: for every (actor, BoardAccess) pair
 * we care about, the SQL predicate's row-membership decision is
 * identical to canViewBoard's in-memory decision.
 *
 * Connects to the database via DATABASE_URL (falling back to the dev
 * DB at quackback@localhost:5432). Skips gracefully if neither is
 * reachable, matching the SKIP_INTEGRATION pattern used by the API
 * integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, eq, and } from 'drizzle-orm'
import { boards, type BoardAccess, type Database } from '@/lib/server/db'
// Direct client import to spin up our own pool — bypasses the global
// `db` proxy/singleton so this test can keep its own short-lived
// connection (and close it cleanly in afterAll). The lint rule
// reserves @quackback/db/client for the canonical db.ts entry; this
// test file is the legitimate second caller of `createDb`.
// eslint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import { canViewBoard, boardViewFilter } from '../boards'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { createId, type SegmentId, type PrincipalId, type BoardId } from '@quackback/ids'

// Two real TypeIDs so segment-tier rows have something to match against.
// The board-level segments[] are string[] in the schema, but callers
// always feed them real segment ids; mirroring that here keeps the JSONB
// containment semantics realistic.
const SEGMENT_ALPHA = createId('segment') as SegmentId
const SEGMENT_BETA = createId('segment') as SegmentId

function mkAccess(view: BoardAccess['view'], segmentIds: string[] = []): BoardAccess {
  // Mirror BoardAccess invariants enforced on save: every action pinned
  // to the same tier so parity reasoning stays simple. The view tier is
  // the only knob this test cares about. Segments mirror the shared
  // shape (same list across all four actions) so the parity matrix
  // continues to express what the legacy shared-list shape did.
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

interface AccessCase {
  name: string
  access: BoardAccess
}

const accessShapes: AccessCase[] = [
  { name: 'anonymous', access: mkAccess('anonymous') },
  { name: 'authenticated', access: mkAccess('authenticated') },
  { name: 'team', access: mkAccess('team') },
  { name: 'segments_alpha', access: mkAccess('segments', [SEGMENT_ALPHA]) },
  { name: 'segments_beta', access: mkAccess('segments', [SEGMENT_BETA]) },
  { name: 'segments_alpha_beta', access: mkAccess('segments', [SEGMENT_ALPHA, SEGMENT_BETA]) },
  // Empty board segment list: in-memory canViewBoard pins this fail-closed
  // (boards.test.ts A.segmentEmpty), but the SQL path — jsonb_array_elements_text
  // over an empty array yielding 0 rows — was only proven structurally. This
  // closes the execution-level parity gap for the empty-list collapse.
  { name: 'segments_empty', access: mkAccess('segments', []) },
]

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
  user: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
  }),
  userInAlpha: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA]),
  }),
  userInAlphaBeta: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA, SEGMENT_BETA]),
  }),
  service: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'service',
  }),
  serviceInAlpha: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'service',
    segmentIds: new Set([SEGMENT_ALPHA]),
  }),
  member: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'member',
    principalType: 'user',
  }),
  admin: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'admin',
    principalType: 'user',
  }),
}

// Prefer the user's explicit DATABASE_URL (which vitest.config sets to
// quackback_test) — but fall back to the dev DB at quackback if the
// configured URL is unreachable. Either DB has the boards schema after
// migrations.
const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const db = createDb(url, { max: 2, prepare: false })
      // Probe with a no-op + boards-shape check. boards must exist for
      // the test to mean anything; reject DBs missing the table.
      await db.execute(sql`select 1`)
      await db.execute(sql`select id, access from ${boards} limit 0`)
      return {
        db,
        // postgres-js attaches its raw client at $client; closing it
        // releases the pool so vitest doesn't hang on exit.
        close: async () => {
          const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
          await raw?.end?.()
        },
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

interface SeededBoard {
  id: BoardId
  name: string
  access: BoardAccess
}

let activeDb: Database | null = null
let closeDb: (() => Promise<void>) | null = null
const seeded: SeededBoard[] = []
// Soft-deleted board — every actor (including team) should see it filtered out
// by boardViewFilter, since each branch now ANDs isNull(boards.deletedAt).
let deletedBoardId: BoardId | null = null
const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Resolve DB availability synchronously-ish via a top-level await
// so describe.skipIf sees a definite boolean.
const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
}

describe.skipIf(!dbAvailable)('boardViewFilter ↔ canViewBoard parity (execution-level)', () => {
  beforeAll(async () => {
    if (!activeDb) return
    // Crash-safety belt: sweep any leftover rows from prior crashed runs
    // before seeding. The per-run afterAll is the primary cleanup path;
    // this catches rows that leaked when the runner died mid-test.
    // Match only test-generated slugs (`parity-<digits>-...`) so we don't
    // delete a real production board that happens to start with `parity-`.
    await activeDb.delete(boards).where(sql`${boards.slug} ~ '^parity-[0-9]+-'`)
    for (const { name, access } of accessShapes) {
      const id = createId('board') as BoardId
      const slug = `parity-${runSuffix}-${name}`
      await activeDb.insert(boards).values({
        id,
        slug,
        name: `parity:${name}`,
        access,
      })
      seeded.push({ id, name, access })
    }
    // Seed a soft-deleted board so we can prove boardViewFilter excludes
    // it regardless of actor. Access tier doesn't matter — anonymous is
    // the most permissive, so if even that branch filters it, all do.
    const deletedId = createId('board') as BoardId
    await activeDb.insert(boards).values({
      id: deletedId,
      slug: `parity-${runSuffix}-deleted`,
      name: 'parity:deleted',
      access: mkAccess('anonymous'),
      deletedAt: new Date(),
    })
    deletedBoardId = deletedId
  })

  afterAll(async () => {
    if (!activeDb) return
    try {
      // Targeted cleanup of THIS run's rows via the unique fingerprint.
      // Pairs with the beforeAll pre-sweep so even a crash here is
      // recovered by the next run.
      await activeDb.delete(boards).where(sql`${boards.slug} LIKE ${`parity-${runSuffix}-%`}`)
    } finally {
      await closeDb?.()
    }
  })

  // For each (actor, access) pair, the SQL filter and the in-memory
  // predicate must agree. We isolate the one seeded row for the
  // shape under test so other boards in the dev DB don't pollute the
  // comparison.
  for (const [actorName, actor] of Object.entries(actors)) {
    for (const accessCase of accessShapes) {
      it(`actor=${actorName} access=${accessCase.name}`, async () => {
        if (!activeDb) return
        const seededRow = seeded.find((s) => s.name === accessCase.name)
        expect(seededRow, `seed row missing for ${accessCase.name}`).toBeDefined()
        if (!seededRow) return

        const expectMemoryAllowed = canViewBoard(actor, { access: accessCase.access }).allowed

        // Use eq() for the id check so the TypeID column mapper converts
        // the TypeID string to UUID — bypassing the mapper with a raw
        // `sql` template causes Postgres to reject the unparsed TypeID.
        const filter = boardViewFilter(actor)
        const matchedRows = await activeDb
          .select({ id: boards.id })
          .from(boards)
          .where(and(eq(boards.id, seededRow.id), filter))

        const expectSqlAllowed = matchedRows.length === 1
        expect(
          expectSqlAllowed,
          `SQL admitted=${expectSqlAllowed} but in-memory admitted=${expectMemoryAllowed} ` +
            `for actor=${actorName} access=${accessCase.name}`
        ).toBe(expectMemoryAllowed)
      })
    }
  }

  describe('boardViewFilter excludes soft-deleted boards', () => {
    for (const [actorName, actor] of Object.entries(actors)) {
      it(`actor=${actorName} sees 0 rows for a soft-deleted board`, async () => {
        if (!activeDb) return
        expect(deletedBoardId, 'deleted board not seeded').not.toBeNull()
        if (!deletedBoardId) return

        const matchedRows = await activeDb
          .select({ id: boards.id })
          .from(boards)
          .where(and(eq(boards.id, deletedBoardId), boardViewFilter(actor)))
        expect(matchedRows.length).toBe(0)
      })
    }
  })
})
