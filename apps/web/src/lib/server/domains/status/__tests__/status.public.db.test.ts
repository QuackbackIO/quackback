/**
 * Execution-level tests for the public status reads that page past the
 * snapshot: incident history and the RSS feed's items.
 *
 * - History resumes after the page's recent window instead of starting again
 *   from the newest incident, which listed the first 14 days twice.
 * - The feed carries open incidents and scheduled or in-progress maintenance,
 *   not only resolved history, newest activity first.
 *
 * Runs the real queries against the real database: the global `db` proxy is
 * pointed at this file's own short-lived connection (closed in afterAll).
 * Connects via DATABASE_URL (vitest pins quackback_test), falling back to the
 * dev DB; skips when neither is reachable, like changelog-segment-targets.db.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, inArray } from 'drizzle-orm'
import {
  statusComponents,
  statusIncidents,
  statusIncidentUpdates,
  statusIncidentComponents,
  type Database,
} from '@/lib/server/db'
// oxlint-disable-next-line no-restricted-imports -- legitimate createDb caller: this file owns the global db for its worker (see help-center-segment-gate.integration.test.ts)
import { createDb } from '@quackback/db/client'
import { createId, type StatusComponentId, type StatusIncidentId } from '@quackback/ids'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import {
  getStatusPageSnapshot,
  listIncidentHistory,
  listStatusFeedItems,
  statusIncidentLastActivityAt,
} from '../status.public'

const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
const ago = (days: number) => new Date(now - days * DAY)

const COMPONENT = createId('status_component') as StatusComponentId
const GATED_COMPONENT = createId('status_component') as StatusComponentId
const RECENT_INCIDENT = createId('status_incident') as StatusIncidentId
const OLD_INCIDENT = createId('status_incident') as StatusIncidentId
const RECENT_MAINTENANCE = createId('status_incident') as StatusIncidentId
const OPEN_INCIDENT = createId('status_incident') as StatusIncidentId
const SCHEDULED_MAINTENANCE = createId('status_incident') as StatusIncidentId
const GATED_INCIDENT = createId('status_incident') as StatusIncidentId
const MINE = [
  RECENT_INCIDENT,
  OLD_INCIDENT,
  RECENT_MAINTENANCE,
  OPEN_INCIDENT,
  SCHEDULED_MAINTENANCE,
  GATED_INCIDENT,
]

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const db = createDb(url, { max: 4, prepare: false })
      await db.execute(sql`select 1`)
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

let activeDb: Database | null = null
let closeDb: (() => Promise<void>) | null = null

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
  ;(globalThis as Record<string, unknown>).__db = resolved.db
}

const mine = (ids: string[]) => ids.filter((id) => MINE.includes(id as StatusIncidentId))

describe.skipIf(!dbAvailable)('public status reads past the snapshot (execution-level)', () => {
  beforeAll(async () => {
    if (!activeDb) return
    await activeDb.insert(statusComponents).values([
      { id: COMPONENT, name: `pub-${runSuffix}` },
      // Visible only to a segment an anonymous visitor is never in.
      { id: GATED_COMPONENT, name: `gated-${runSuffix}`, segmentIds: ['segment_nobody'] },
    ])

    const incident = (
      id: StatusIncidentId,
      kind: 'incident' | 'maintenance',
      status: string,
      startedAt: Date,
      resolvedAt: Date | null,
      scheduled?: { start: Date; end: Date }
    ) => ({
      id,
      kind,
      status: status as never,
      title: `pub-${runSuffix}-${status}`,
      impact: (kind === 'maintenance' ? 'maintenance' : 'major') as never,
      startedAt,
      resolvedAt,
      scheduledStartAt: scheduled?.start ?? null,
      scheduledEndAt: scheduled?.end ?? null,
    })
    await activeDb.insert(statusIncidents).values([
      incident(RECENT_INCIDENT, 'incident', 'resolved', ago(2), ago(1.9)),
      incident(OLD_INCIDENT, 'incident', 'resolved', ago(20), ago(19.9)),
      incident(RECENT_MAINTENANCE, 'maintenance', 'completed', ago(3), ago(2.9)),
      incident(OPEN_INCIDENT, 'incident', 'investigating', ago(0.1), null),
      incident(SCHEDULED_MAINTENANCE, 'maintenance', 'scheduled', ago(0.5), null, {
        start: new Date(now + 2 * DAY),
        end: new Date(now + 2 * DAY + 2 * 60 * 60 * 1000),
      }),
      incident(GATED_INCIDENT, 'incident', 'investigating', ago(0.05), null),
    ])

    await activeDb.insert(statusIncidentComponents).values(
      MINE.map((id) => ({
        incidentId: id,
        componentId: id === GATED_INCIDENT ? GATED_COMPONENT : COMPONENT,
        componentStatus: 'partial_outage' as const,
      }))
    )

    // One update per row, written when the row last changed.
    const lastChange: Record<string, Date> = {
      [RECENT_INCIDENT]: ago(1.9),
      [OLD_INCIDENT]: ago(19.9),
      [RECENT_MAINTENANCE]: ago(2.9),
      [OPEN_INCIDENT]: ago(0.1),
      [SCHEDULED_MAINTENANCE]: ago(0.5),
      [GATED_INCIDENT]: ago(0.05),
    }
    await activeDb.insert(statusIncidentUpdates).values(
      MINE.map((id) => ({
        incidentId: id,
        status: 'investigating' as never,
        body: 'update',
        createdAt: lastChange[id],
      }))
    )
  }, 60_000)

  afterAll(async () => {
    if (activeDb) {
      await activeDb.delete(statusIncidents).where(inArray(statusIncidents.id, MINE))
      await activeDb
        .delete(statusComponents)
        .where(inArray(statusComponents.id, [COMPONENT, GATED_COMPONENT]))
    }
    delete (globalThis as Record<string, unknown>).__db
    await closeDb?.()
  })

  it('resumes incident history after the incidents the page already lists', async () => {
    const snapshot = await getStatusPageSnapshot(ANONYMOUS_ACTOR, { pageDescription: null })
    const recentIds = snapshot.recentIncidents.flatMap((d) => d.incidents.map((i) => i.id))
    expect(mine(recentIds)).toEqual([RECENT_INCIDENT])
    expect(snapshot.recentWindow.days).toBe(14)

    const history = await listIncidentHistory(ANONYMOUS_ACTOR, {
      limit: 100,
      before: snapshot.recentWindow.start,
    })
    // The 14-day incident is not repeated; older incidents follow, and a
    // window completed this week (never in the recent list) is still shown.
    expect(mine(history.items.map((i) => i.id))).toEqual([RECENT_MAINTENANCE, OLD_INCIDENT])
  })

  it('without a cutoff, history still lists every resolved item', async () => {
    const history = await listIncidentHistory(ANONYMOUS_ACTOR, { limit: 100 })
    expect(mine(history.items.map((i) => i.id))).toEqual([
      RECENT_INCIDENT,
      RECENT_MAINTENANCE,
      OLD_INCIDENT,
    ])
  })

  it('feeds open incidents and scheduled maintenance with resolved history, newest activity first', async () => {
    const items = await listStatusFeedItems(ANONYMOUS_ACTOR, 50)
    // The gated incident's only component is hidden from this visitor.
    expect(mine(items.map((i) => i.id))).toEqual([
      OPEN_INCIDENT,
      SCHEDULED_MAINTENANCE,
      RECENT_INCIDENT,
      RECENT_MAINTENANCE,
      OLD_INCIDENT,
    ])
    const activity = items.map((i) => statusIncidentLastActivityAt(i).getTime())
    expect(activity).toEqual([...activity].sort((a, b) => b - a))
  })
})
