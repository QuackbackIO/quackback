/**
 * Execution-level parity test: changelogViewFilter (SQL) ↔ canViewChangelog
 * (in-memory). For every (actor, ChangelogAccess) pair, the SQL predicate's
 * row-membership decision must match the in-memory decision.
 *
 * Unlike the board/roadmap parity tests, changelogViewFilter does NOT filter
 * soft-deleted rows (the public readers compose that separately), so this test
 * seeds only live rows and compares the pure audience gate. Entries also need
 * a non-null publishedAt only for realism — the filter ignores it.
 *
 * Connects via DATABASE_URL (falling back to the dev DB). Skips gracefully if
 * neither is reachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, eq, and } from 'drizzle-orm'
import { changelogEntries, type ChangelogAccess, type Database } from '@/lib/server/db'
// eslint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import { canViewChangelog, changelogViewFilter } from '../changelog'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { createId, type SegmentId, type PrincipalId, type ChangelogId } from '@quackback/ids'

const SEGMENT_ALPHA = createId('segment') as SegmentId
const SEGMENT_BETA = createId('segment') as SegmentId

function mkAccess(view: ChangelogAccess['view'], segmentIds: string[] = []): ChangelogAccess {
  return { view, segments: { view: segmentIds } }
}

interface AccessCase {
  name: string
  access: ChangelogAccess
}

const accessShapes: AccessCase[] = [
  { name: 'anonymous', access: mkAccess('anonymous') },
  { name: 'authenticated', access: mkAccess('authenticated') },
  { name: 'team', access: mkAccess('team') },
  { name: 'segments_alpha', access: mkAccess('segments', [SEGMENT_ALPHA]) },
  { name: 'segments_beta', access: mkAccess('segments', [SEGMENT_BETA]) },
  { name: 'segments_alpha_beta', access: mkAccess('segments', [SEGMENT_ALPHA, SEGMENT_BETA]) },
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
      await db.execute(sql`select id, access from ${changelogEntries} limit 0`)
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

interface SeededEntry {
  id: ChangelogId
  name: string
  access: ChangelogAccess
}

let activeDb: Database | null = null
let closeDb: (() => Promise<void>) | null = null
const seeded: SeededEntry[] = []
const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
}

describe.skipIf(!dbAvailable)(
  'changelogViewFilter ↔ canViewChangelog parity (execution-level)',
  () => {
    beforeAll(async () => {
      if (!activeDb) return
      // Crash-safety belt: sweep leftover rows from prior crashed runs.
      await activeDb
        .delete(changelogEntries)
        .where(sql`${changelogEntries.title} ~ '^parity-cl-[0-9]+-'`)
      for (const { name, access } of accessShapes) {
        const id = createId('changelog') as ChangelogId
        await activeDb.insert(changelogEntries).values({
          id,
          title: `parity-cl-${runSuffix}-${name}`,
          content: 'parity',
          access,
        })
        seeded.push({ id, name, access })
      }
    })

    afterAll(async () => {
      if (!activeDb) return
      try {
        await activeDb
          .delete(changelogEntries)
          .where(sql`${changelogEntries.title} LIKE ${`parity-cl-${runSuffix}-%`}`)
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

          const expectMemoryAllowed = canViewChangelog(actor, { access: accessCase.access }).allowed

          const filter = changelogViewFilter(actor)
          const matchedRows = await activeDb
            .select({ id: changelogEntries.id })
            .from(changelogEntries)
            .where(and(eq(changelogEntries.id, seededRow.id), filter))

          const expectSqlAllowed = matchedRows.length === 1
          expect(
            expectSqlAllowed,
            `SQL admitted=${expectSqlAllowed} but in-memory admitted=${expectMemoryAllowed} ` +
              `for actor=${actorName} access=${accessCase.name}`
          ).toBe(expectMemoryAllowed)
        })
      }
    }
  }
)
