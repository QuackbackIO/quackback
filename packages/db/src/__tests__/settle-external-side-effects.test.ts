/**
 * The restore entry point: policy application, idempotency, and the marker.
 *
 * The statements are rendered and asserted rather than run, and the executor
 * drives a stub that records what it was asked to do. That keeps the suite a
 * unit test while still pinning the two things a restore depends on: the
 * exact predicates (which are what makes a rerun a no-op) and the fact that
 * every write, including the audit row, lands inside one transaction.
 */
import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import {
  RESTORE_SETTLEMENT_AUDIT_EVENT,
  planSideEffectSettlement,
  settleExternalSideEffects,
  type SettlementStep,
} from '../settle-external-side-effects'
import type { Database } from '../client'
import * as schema from '../schema'
import type { LedgerRegistration } from '../side-effect-ledger'

/**
 * Fixture registrations, so every executor branch stays covered by its own
 * case. Reclassifying a real column is then a registry decision that does not
 * silently uncover a branch: `restart-window` and `reset` are part of the
 * vocabulary the guard offers, so they must keep working whether or not a real
 * column happens to use them today.
 */
const FIXTURE_REGISTRY: readonly LedgerRegistration[] = [
  {
    column: schema.invitation.lastSentAt,
    policy: 'settle',
    strategy: 'restart-window',
    reason: 'fixture: a cooldown watermark, where the hazard is a stale value',
  },
  {
    column: schema.integrations.lastOutboundAt,
    policy: 'reset',
    reason: 'fixture: freshness telemetry with no externally visible effect',
  },
]

const dialect = new PgDialect()
const RESTORED_TO = new Date('2026-07-30T12:00:00.000Z')
const fixtureSteps = planSideEffectSettlement({ restoredTo: RESTORED_TO }, FIXTURE_REGISTRY)

function render(statement: SQL | null): string {
  return statement === null ? '' : dialect.sqlToQuery(statement).sql
}

function stepFor(steps: SettlementStep[], key: string): SettlementStep {
  const step = steps.find((s) => s.key === key)
  if (!step) throw new Error(`no planned step for ${key}`)
  return step
}

interface FakeDb {
  db: Database
  executed: string[]
  auditRows: Array<Record<string, unknown>>
  transactions: number
}

/**
 * A stub that answers the two shapes the executor issues: the marker lookup
 * (a SELECT against audit_log) and the counting updates. Inserted audit rows
 * are fed back to the lookup so a second run can find the first one.
 */
function makeFakeDb(rowsAffectedPerStatement = 2): FakeDb {
  const state: FakeDb = {
    executed: [],
    auditRows: [],
    transactions: 0,
    db: null as unknown as Database,
  }

  const tx = {
    execute: async (statement: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(statement)
      state.executed.push(text)
      if (text.includes('FROM "audit_log"')) {
        const restoredTo = params[params.length - 1]
        const match = state.auditRows.find(
          (row) =>
            (row.metadata as { restoredTo?: string } | null)?.restoredTo === String(restoredTo)
        )
        return match ? [{ occurred_at: (match.occurredAt as Date).toISOString() }] : []
      }
      return [{ rows_affected: rowsAffectedPerStatement }]
    },
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        state.auditRows.push(row)
      },
    }),
  }

  state.db = {
    transaction: async (cb: (t: unknown) => unknown) => {
      state.transactions += 1
      return cb(tx)
    },
  } as unknown as Database

  return state
}

describe('planSideEffectSettlement', () => {
  const steps = planSideEffectSettlement({ restoredTo: RESTORED_TO })

  it('accounts for every registered column, including the ones it leaves alone', () => {
    expect(steps.length).toBeGreaterThanOrEqual(15)
    expect(steps.every((step) => step.reason.length > 0)).toBe(true)
  })

  it('settles a delivery receipt by filling only the unstamped rows', () => {
    const step = stepFor(steps, 'events.published_at')
    expect(step.policy).toBe('settle')
    expect(step.action).toBe('stamp-pending')
    expect(render(step.statement)).toBe(
      'WITH settled AS (UPDATE "events" SET "published_at" = $1 WHERE "events"."published_at" IS NULL RETURNING 1) SELECT count(*)::int AS rows_affected FROM settled'
    )
  })

  it('settles a rate-limit window by pushing stale values forward to the restore', () => {
    const steps = fixtureSteps
    const step = stepFor(steps, 'invitation.last_sent_at')
    expect(step.action).toBe('restart-window')
    expect(render(step.statement)).toBe(
      'WITH settled AS (UPDATE "invitation" SET "last_sent_at" = $1 WHERE "invitation"."last_sent_at" IS NULL OR "invitation"."last_sent_at" < $2 RETURNING 1) SELECT count(*)::int AS rows_affected FROM settled'
    )
  })

  it('scopes stamp-pending to the rows the consumer could have drained', () => {
    // A bare IS NULL would also stamp drafts and future-dated entries, and the
    // claim query requires IS NULL, so that would disarm them permanently.
    const step = stepFor(steps, 'changelog_entries.notified_at')
    expect(step.action).toBe('stamp-pending')
    // Drizzle's own helpers render lower case, the raw fragment upper case.
    const text = render(step.statement).toLowerCase()
    expect(text).toContain('"changelog_entries"."notified_at" is null')
    expect(text).toContain('"changelog_entries"."published_at" is not null')
    expect(text).toContain('"changelog_entries"."published_at" <=')
  })

  it('preserves content state, issuing no statement at all', () => {
    const step = stepFor(steps, 'changelog_entries.published_at')
    expect(step.policy).toBe('preserve')
    expect(step.action).toBe('preserve')
    expect(step.statement).toBeNull()
  })

  it('clears freshness telemetry', () => {
    const step = stepFor(fixtureSteps, 'integrations.last_outbound_at')
    expect(step.policy).toBe('reset')
    expect(step.action).toBe('clear')
    expect(render(step.statement)).toBe(
      'WITH settled AS (UPDATE "integrations" SET "last_outbound_at" = NULL WHERE "integrations"."last_outbound_at" IS NOT NULL RETURNING 1) SELECT count(*)::int AS rows_affected FROM settled'
    )
  })

  it('stamps every settled column with the restore instant', () => {
    for (const step of steps) {
      if (step.action !== 'stamp-pending' && step.action !== 'restart-window') continue
      expect(dialect.sqlToQuery(step.statement!).params).toContain(RESTORED_TO)
    }
  })

  it('every statement re-runs as a no-op, because its predicate excludes what it writes', () => {
    for (const step of steps) {
      const text = render(step.statement)
      // Narrowed by eligibleWhen on some columns, so assert the self-excluding
      // clause is present rather than that it is the whole predicate.
      if (step.action === 'stamp-pending') expect(text).toMatch(/IS NULL( |\))/)
      if (step.action === 'restart-window') expect(text).toMatch(/IS NULL OR .+ < \$2 RETURNING/)
      if (step.action === 'clear') expect(text).toContain('= NULL WHERE')
      if (step.action === 'clear') expect(text).toContain('IS NOT NULL RETURNING')
    }
  })
})

describe('replay is opt-in', () => {
  it('replays nothing by default, so a caller who says nothing gets suppression', () => {
    const steps = planSideEffectSettlement({ restoredTo: RESTORED_TO })
    expect(steps.filter((step) => step.action === 'replay')).toEqual([])
  })

  it('skips exactly the columns the caller names', () => {
    const steps = planSideEffectSettlement({
      restoredTo: RESTORED_TO,
      replay: ['events.published_at'],
    })
    const replayed = stepFor(steps, 'events.published_at')
    expect(replayed.action).toBe('replay')
    expect(replayed.statement).toBeNull()
    // Naming one column must not disarm the rest.
    expect(stepFor(steps, 'changelog_entries.notified_at').action).toBe('stamp-pending')
  })

  it('throws on an unrecognised replay key rather than silently ignoring it', () => {
    expect(() =>
      planSideEffectSettlement({ restoredTo: RESTORED_TO, replay: ['events.publishd_at'] })
    ).toThrow(/Unknown replay target/)
  })
})

describe('settleExternalSideEffects', () => {
  it('applies every policy and the marker in a single transaction', async () => {
    const fake = makeFakeDb()
    const report = await settleExternalSideEffects(fake.db, { restoredTo: RESTORED_TO })

    expect(fake.transactions).toBe(1)
    expect(report.restoredTo).toBe(RESTORED_TO)
    expect(report.replayed).toEqual([])
    // Marker lookup plus one statement per acting step.
    const acting = report.steps.filter((step) => step.statement !== null)
    expect(fake.executed.length).toBe(acting.length + 1)
    expect(fake.executed[0]).toContain('FROM "audit_log"')
  })

  it('reports rows touched per column and in total', async () => {
    const fake = makeFakeDb(3)
    const report = await settleExternalSideEffects(fake.db, { restoredTo: RESTORED_TO })

    const acting = report.steps.filter((step) => step.statement !== null)
    expect(acting.every((step) => step.rowsAffected === 3)).toBe(true)
    // Preserved columns are reported, but nothing was done to them.
    expect(
      report.steps.filter((step) => step.action === 'preserve').every((s) => s.rowsAffected === 0)
    ).toBe(true)
    expect(report.totalRowsAffected).toBe(acting.length * 3)
  })

  it('writes a durable, auditable marker naming the restore it settled', async () => {
    const fake = makeFakeDb()
    const report = await settleExternalSideEffects(fake.db, {
      restoredTo: RESTORED_TO,
      replay: ['events.published_at'],
    })

    expect(fake.auditRows).toHaveLength(1)
    const row = fake.auditRows[0]
    expect(row.eventType).toBe(RESTORE_SETTLEMENT_AUDIT_EVENT)
    expect(row.eventOutcome).toBe('success')
    expect(row.actorType).toBe('system')
    expect(row.targetType).toBe('database')

    const metadata = row.metadata as Record<string, unknown>
    expect(metadata.restoredTo).toBe(RESTORED_TO.toISOString())
    expect(metadata.replayed).toEqual(['events.published_at'])
    expect(metadata.previouslySettledAt).toBeNull()
    expect(metadata.totalRowsAffected).toBe(report.totalRowsAffected)
    expect(metadata.steps).toHaveLength(report.steps.length)
  })

  it('is safe to run twice: the same statements, and the rerun sees the first marker', async () => {
    const fake = makeFakeDb()
    const first = await settleExternalSideEffects(fake.db, { restoredTo: RESTORED_TO })
    const afterFirst = [...fake.executed]

    fake.executed.length = 0
    const second = await settleExternalSideEffects(fake.db, { restoredTo: RESTORED_TO })

    expect(fake.executed).toEqual(afterFirst)
    expect(first.previouslySettledAt).toBeNull()
    expect(second.previouslySettledAt).toEqual(first.appliedAt)
    // The rerun is recorded too: the marker is an audit trail, not a lock.
    expect(fake.auditRows).toHaveLength(2)
    expect((fake.auditRows[1].metadata as Record<string, unknown>).previouslySettledAt).toBe(
      first.appliedAt.toISOString()
    )
  })

  it('treats a different restore instant as a separate, unsettled restore', async () => {
    const fake = makeFakeDb()
    await settleExternalSideEffects(fake.db, { restoredTo: RESTORED_TO })
    const other = await settleExternalSideEffects(fake.db, {
      restoredTo: new Date('2026-07-31T09:00:00.000Z'),
    })
    expect(other.previouslySettledAt).toBeNull()
  })
})
