/**
 * Anti-rot guard for the external side-effect ledger.
 *
 * The registry only protects a restore if it is complete, so this suite fails
 * when a ledger-shaped column exists in the schema and nobody has classified
 * it. It is modelled on the locale-parity gate: derive the truth from the
 * source (here, Drizzle's table metadata), diff it against the hand-written
 * registry, and make the failure message say what to do.
 *
 * The negative cases matter as much as the positive one. A guard that only
 * asserts "the current schema passes" cannot tell the difference between
 * working and broken, so the detection is also pointed at fixture tables that
 * are deliberately unclassified.
 */
import { describe, it, expect } from 'vitest'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import {
  LEDGER_CLASSIFICATION_INSTRUCTIONS,
  SIDE_EFFECT_LEDGER,
  SIDE_EFFECT_LEDGER_EXEMPTIONS,
  classifiedLedgerColumns,
  collectLedgerShapedColumns,
  findStaleLedgerClassifications,
  findUnclassifiedLedgerColumns,
  isLedgerShapedColumnName,
  ledgerColumnKey,
} from '../side-effect-ledger'

// A table shaped like something a future feature would add: it records that a
// digest email went out, and nobody has decided what a restore does about it.
const fixtureUnclassified = pgTable('fixture_digests', {
  id: text('id').primaryKey(),
  recipient: text('recipient'),
  digestEmailedAt: timestamp('digest_emailed_at', { withTimezone: true }),
})

// The same table without the ledger column: ordinary bookkeeping only.
const fixtureInnocuous = pgTable('fixture_notes', {
  id: text('id').primaryKey(),
  body: text('body'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
})

describe('side-effect ledger guard', () => {
  it('classifies every ledger-shaped column in the schema', () => {
    const unclassified = findUnclassifiedLedgerColumns()
    expect(
      unclassified,
      unclassified.length === 0
        ? ''
        : `\n\nUnclassified side-effect ledger column(s):\n  ${unclassified.join('\n  ')}\n\n${LEDGER_CLASSIFICATION_INSTRUCTIONS}\n`
    ).toEqual([])
  })

  it('carries no classification for a column that is no longer ledger-shaped', () => {
    const stale = findStaleLedgerClassifications()
    expect(
      stale,
      stale.length === 0
        ? ''
        : `\n\nClassified but no longer present or no longer ledger-shaped:\n  ${stale.join('\n  ')}\n\n` +
            'Either the column was renamed or dropped (remove the entry from SIDE_EFFECT_LEDGER /\n' +
            'SIDE_EFFECT_LEDGER_EXEMPTIONS in packages/db/src/side-effect-ledger.ts), or\n' +
            'LEDGER_COLUMN_PATTERNS was narrowed and no longer sees a column that still matters\n' +
            '(restore the pattern).\n'
    ).toEqual([])
  })

  // Without this, the guard could pass because the detection is broken rather
  // than because the registry is complete.
  it('rejects an unclassified ledger-shaped column in a fixture schema', () => {
    expect(findUnclassifiedLedgerColumns({ fixtureUnclassified })).toEqual([
      'fixture_digests.digest_emailed_at',
    ])
  })

  it('leaves ordinary bookkeeping columns alone', () => {
    expect(collectLedgerShapedColumns({ fixtureInnocuous })).toEqual([])
    expect(findUnclassifiedLedgerColumns({ fixtureInnocuous })).toEqual([])
  })

  it('finds something to guard (a silently empty sweep would pass vacuously)', () => {
    expect(collectLedgerShapedColumns().length).toBeGreaterThanOrEqual(15)
  })
})

describe('ledger shape detection', () => {
  it.each([
    'notified_at',
    'last_sent_at',
    'digest_emailed_at',
    'csat_email_sent_at',
    'published_at',
    'announced_at',
    'last_sync_at',
    'last_triggered_at',
    'last_outbound_at',
    'processed_at',
    'escalation_offered_at',
    'executed_at',
    'used_at',
  ])('treats %s as a record of an external action', (name) => {
    expect(isLedgerShapedColumnName(name)).toBe(true)
  })

  // Plain recency stamps are not one-shot ledgers, and matching them would
  // bury the real ones under noise nobody reads.
  it.each([
    'created_at',
    'updated_at',
    'deleted_at',
    'expires_at',
    'occurred_at',
    'resolved_at',
    'verified_at',
    'last_seen_at',
    'last_used_at',
    'last_message_at',
    'unsubscribed_at',
    'computed_at',
    'embedding_updated_at',
  ])('does not treat %s as a record of an external action', (name) => {
    expect(isLedgerShapedColumnName(name)).toBe(false)
  })
})

describe('registry entries', () => {
  const keys = SIDE_EFFECT_LEDGER.map((entry) => ledgerColumnKey(entry.column))

  it('registers each column at most once', () => {
    expect(keys).toEqual([...new Set(keys)])
  })

  it('never registers and exempts the same column', () => {
    const exempt = SIDE_EFFECT_LEDGER_EXEMPTIONS.map((entry) => ledgerColumnKey(entry.column))
    expect(keys.filter((key) => exempt.includes(key))).toEqual([])
    // classifiedLedgerColumns() dedupes, so a collision would otherwise hide.
    expect(classifiedLedgerColumns().size).toBe(keys.length + exempt.length)
  })

  it('gives every classification a reason a reader can act on', () => {
    for (const entry of [...SIDE_EFFECT_LEDGER, ...SIDE_EFFECT_LEDGER_EXEMPTIONS]) {
      const key = ledgerColumnKey(entry.column)
      expect(entry.reason.length, `${key} needs a reason naming the consumer`).toBeGreaterThan(60)
      expect(entry.reason.trim(), `${key} reason must be a sentence`).toMatch(/\.$/)
    }
  })

  it('makes every settle entry choose a strategy', () => {
    for (const entry of SIDE_EFFECT_LEDGER) {
      if (entry.policy !== 'settle') continue
      expect(
        ['stamp-pending', 'restart-window'],
        `${ledgerColumnKey(entry.column)} must pick a settle strategy`
      ).toContain(entry.strategy)
    }
  })

  // The reason the registry is keyed per column and not per table.
  it('classifies the two changelog_entries columns differently', () => {
    const byKey = new Map(SIDE_EFFECT_LEDGER.map((e) => [ledgerColumnKey(e.column), e]))
    expect(byKey.get('changelog_entries.notified_at')?.policy).toBe('settle')
    expect(byKey.get('changelog_entries.published_at')?.policy).toBe('preserve')
  })

  // Deliberately not "every policy is used by a real column". Which policy a
  // column deserves is a fact about its consumer, so the registry must be free
  // to hold none of a given policy without a test objecting. The executor's
  // branches are covered by fixtures in settle-external-side-effects.test.ts
  // instead, so reclassifying a column never quietly uncovers one.
  it('registers at least one settled column, so suppression is actually wired', () => {
    const settled = SIDE_EFFECT_LEDGER.filter((entry) => entry.policy === 'settle')
    expect(settled.length).toBeGreaterThan(0)
  })

  it('gives every stamp-pending column that needs one an eligibility predicate', () => {
    // A consumer that tests more than the column itself needs the stamp scoped
    // to what it would actually have drained, or settling disarms rows that
    // were never eligible. changelog_entries is the known case: its claim query
    // also requires the entry to be live.
    const byKey = new Map(SIDE_EFFECT_LEDGER.map((e) => [ledgerColumnKey(e.column), e]))
    const changelog = byKey.get('changelog_entries.notified_at')
    expect(changelog?.policy).toBe('settle')
    expect(changelog?.policy === 'settle' && changelog.eligibleWhen).toBeTypeOf('function')
  })
})
