/**
 * Execution-level parity test: roadmapViewFilter (SQL) ↔ canViewRoadmap (in-memory).
 *
 * The view-only mirror of board-view-filter-parity.test.ts. For every
 * (actor, RoadmapAccess) pair we care about, the SQL predicate's row-membership
 * decision must be identical to canViewRoadmap's in-memory decision — otherwise
 * a refactor could ship a subtle list-vs-detail visibility drift.
 *
 * Connects via DATABASE_URL (falling back to the dev DB). Skips gracefully if
 * neither is reachable, matching the SKIP_INTEGRATION pattern.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, eq, and } from 'drizzle-orm'
import { roadmaps, type RoadmapAccess, type Database } from '@/lib/server/db'
// Direct client import to spin up our own pool — bypasses the global `db`
// proxy/singleton so this test keeps its own short-lived connection.
// eslint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import { canViewRoadmap, roadmapViewFilter } from '../roadmaps'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { createId, type SegmentId, type PrincipalId, type RoadmapId } from '@quackback/ids'

const SEGMENT_ALPHA = createId('segment') as SegmentId
const SEGMENT_BETA = createId('segment') as SegmentId

function mkAccess(view: RoadmapAccess['view'], segmentIds: string[] = []): RoadmapAccess {
  return { view, segments: { view: segmentIds } }
}

interface AccessCase {
  name: string
  access: RoadmapAccess
}

const accessShapes: AccessCase[] = [
  { name: 'anonymous', access: mkAccess('anonymous') },
  { name: 'authenticated', access: mkAccess('authenticated') },
  { name: 'team', access: mkAccess('team') },
  { name: 'segments_alpha', access: mkAccess('segments', [SEGMENT_ALPHA]) },
  { name: 'segments_beta', access: mkAccess('segments', [SEGMENT_BETA]) },
  { name: 'segments_alpha_beta', access: mkAccess('segments', [SEGMENT_ALPHA, SEGMENT_BETA]) },
  // Empty segment list: in-memory canViewRoadmap pins this fail-closed; the SQL
  // path (jsonb_array_elements_text over an empty array → 0 rows) collapses to
  // the same. This closes the execution-level parity gap for the empty list.
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

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const db = createDb(url, { max: 2, prepare: false })
      await db.execute(sql`select 1`)
      await db.execute(sql`select id, access from ${roadmaps} limit 0`)
      return {
        db,
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

interface SeededRoadmap {
  id: RoadmapId
  name: string
  access: RoadmapAccess
}

let activeDb: Database | null = null
let closeDb: (() => Promise<void>) | null = null
const seeded: SeededRoadmap[] = []
// Soft-deleted roadmap — every actor (including team) should see it filtered
// out, since each branch ANDs isNull(roadmaps.deletedAt).
let deletedRoadmapId: RoadmapId | null = null
const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
}

describe.skipIf(!dbAvailable)('roadmapViewFilter ↔ canViewRoadmap parity (execution-level)', () => {
  beforeAll(async () => {
    if (!activeDb) return
    // Crash-safety belt: sweep leftover rows from prior crashed runs. Match
    // only test-generated slugs so we never delete a real roadmap.
    await activeDb.delete(roadmaps).where(sql`${roadmaps.slug} ~ '^parity-rm-[0-9]+-'`)
    let position = 0
    for (const { name, access } of accessShapes) {
      const id = createId('roadmap') as RoadmapId
      const slug = `parity-rm-${runSuffix}-${name}`
      await activeDb.insert(roadmaps).values({
        id,
        slug,
        name: `parity:${name}`,
        access,
        position: position++,
      })
      seeded.push({ id, name, access })
    }
    const deletedId = createId('roadmap') as RoadmapId
    await activeDb.insert(roadmaps).values({
      id: deletedId,
      slug: `parity-rm-${runSuffix}-deleted`,
      name: 'parity:deleted',
      access: mkAccess('anonymous'),
      position,
      deletedAt: new Date(),
    })
    deletedRoadmapId = deletedId
  })

  afterAll(async () => {
    if (!activeDb) return
    try {
      await activeDb
        .delete(roadmaps)
        .where(sql`${roadmaps.slug} LIKE ${`parity-rm-${runSuffix}-%`}`)
    } finally {
      await closeDb?.()
    }
  })

  for (const [actorName, actor] of Object.entries(actors)) {
    for (const accessCase of accessShapes) {
      it(`actor=${actorName} access=${accessCase.name}`, async () => {
        if (!activeDb) return
        const seededRow = seeded.find((s) => s.name === accessCase.name)
        expect(seededRow, `seed row missing for ${accessCase.name}`).toBeDefined()
        if (!seededRow) return

        const expectMemoryAllowed = canViewRoadmap(actor, { access: accessCase.access }).allowed

        const filter = roadmapViewFilter(actor)
        const matchedRows = await activeDb
          .select({ id: roadmaps.id })
          .from(roadmaps)
          .where(and(eq(roadmaps.id, seededRow.id), filter))

        const expectSqlAllowed = matchedRows.length === 1
        expect(
          expectSqlAllowed,
          `SQL admitted=${expectSqlAllowed} but in-memory admitted=${expectMemoryAllowed} ` +
            `for actor=${actorName} access=${accessCase.name}`
        ).toBe(expectMemoryAllowed)
      })
    }
  }

  describe('roadmapViewFilter excludes soft-deleted roadmaps', () => {
    for (const [actorName, actor] of Object.entries(actors)) {
      it(`actor=${actorName} sees 0 rows for a soft-deleted roadmap`, async () => {
        if (!activeDb) return
        expect(deletedRoadmapId, 'deleted roadmap not seeded').not.toBeNull()
        if (!deletedRoadmapId) return

        const matchedRows = await activeDb
          .select({ id: roadmaps.id })
          .from(roadmaps)
          .where(and(eq(roadmaps.id, deletedRoadmapId), roadmapViewFilter(actor)))
        expect(matchedRows.length).toBe(0)
      })
    }
  })
})
