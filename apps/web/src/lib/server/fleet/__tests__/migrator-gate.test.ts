/**
 * The three decisions the reconciler makes before it touches a workspace's schema:
 * *what would drizzle apply*, *does this ledger have a hole in it*, and *is any
 * of it dangerous to apply twice*.
 *
 * All pure, and all read off the real bundled journal, because the question they
 * answer is about this corpus and this driver rather than about a fixture
 * someone wrote to make them pass. The heal these gates guard is exercised
 * against a real Postgres in `migrator-gap-heal.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_MIGRATIONS,
  MIGRATIONS_DIR,
  latestBundledVersion,
  type AppliedLedger,
} from '@quackback/db/schema-version'
import { assessReplaySafety } from '@/lib/server/policy/migration-contract/replay-safety'
import { gapHealVerdict, ledgerGapFor, planFor, replayGateVerdict, replaySetFor } from '../migrator'

function ledger(versions: number[]): AppliedLedger {
  return {
    versions: new Set(versions),
    count: versions.length,
    max: versions.length === 0 ? 0 : Math.max(...versions),
  }
}

const verdictsFor = (tags: string[]) =>
  tags.map((tag) =>
    assessReplaySafety(tag, readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8'))
  )

const ALL_WHEN = BUNDLED_MIGRATIONS.map((e) => e.when)

/** Journal `when` for a `0NNN` prefix, so a fixture reads as the tag an operator would. */
const whenOf = (prefix: string) =>
  BUNDLED_MIGRATIONS.find((e) => e.tag.startsWith(`${prefix}_`))!.when

/** Full tag for a `0NNN` prefix. */
const tagOf = (prefix: string) =>
  BUNDLED_MIGRATIONS.find((e) => e.tag.startsWith(`${prefix}_`))!.tag

/** Bundled tags strictly above a high-water mark: the forward rollout tail. */
const tagsAbove = (mark: number) =>
  BUNDLED_MIGRATIONS.filter((e) => e.when > mark).map((e) => e.tag)

/** Bundled tags from `from` to the tip, inclusive: a contiguous replay span. */
const tagsFrom = (from: number) =>
  BUNDLED_MIGRATIONS.filter((e) => e.when >= from).map((e) => e.tag)

/** A complete ledger with these migrations' rows removed — what `psql -f` drift looks like. */
const withoutRows = (...prefixes: string[]) => {
  const removed = new Set(prefixes.map(whenOf))
  return ALL_WHEN.filter((v) => !removed.has(v))
}

/** A representative row physically absent below the mark: the hole itself. */
const REPRESENTATIVE_HOLE = ['0250']

/** A later applied row that makes the missing row invisible to drizzle. */
const REPRESENTATIVE_MARK = whenOf('0252')

/**
 * A high-water mark at `0252` with the `0250` row absent, while the database
 * physically carries the migration's effects.
 *
 * Everything above the mark is withheld, because the measurement is a hole
 * *below* a mark with an ordinary rollout tail *above* it. That tail is derived
 * from the journal rather than listed, and it has to be: a newer migration
 * whose row this fixture kept would move the mark past the tail, turning the
 * tail into part of the hole and quietly replacing the measured shape with a
 * different one that happens to still parse. Listing it by tag meant every
 * migration added after this was written silently re-shaped the fixture.
 */
const REPRESENTATIVE_DRIFT = (() => {
  const holes = new Set(REPRESENTATIVE_HOLE.map(whenOf))
  return ALL_WHEN.filter((v) => v <= REPRESENTATIVE_MARK && !holes.has(v))
})()

describe('replaySetFor', () => {
  it('is everything on a database that has never been migrated', () => {
    const set = replaySetFor(ledger([]))
    expect(set).toHaveLength(BUNDLED_MIGRATIONS.length)
    expect(set[0]).toBe(BUNDLED_MIGRATIONS[0]!.tag)
  })

  it('is empty on a database already at the newest bundled migration', () => {
    expect(replaySetFor(ledger(BUNDLED_MIGRATIONS.map((e) => e.when)))).toEqual([])
  })

  it('is a SUFFIX by `when` — drizzle never revisits a gap below the high-water mark', () => {
    // PgDialect.migrate reads `order by created_at desc limit 1` and applies
    // every bundled entry strictly greater than that single value. A hole below
    // it is invisible to the migrator, which is exactly why the compatibility
    // gate checks the whole prefix instead of the maximum.
    const all = BUNDLED_MIGRATIONS.map((e) => e.when)
    const gapIndex = all.length - 5
    const gapped = all.filter((_, i) => i !== gapIndex)
    const set = replaySetFor(ledger(gapped))
    expect(set).toEqual([])
    expect(BUNDLED_MIGRATIONS[gapIndex]!.when).toBeLessThan(latestBundledVersion())
  })

  it('is the tail above the newest applied row', () => {
    const cutoff = BUNDLED_MIGRATIONS.findIndex((e) => e.tag.startsWith('0248_'))
    const applied = BUNDLED_MIGRATIONS.slice(0, cutoff + 1).map((e) => e.when)
    expect(replaySetFor(ledger(applied))).toEqual(
      BUNDLED_MIGRATIONS.slice(cutoff + 1).map((e) => e.tag)
    )
  })
})

describe('ledgerGapFor', () => {
  it('is null on a database that has never been migrated', () => {
    // Every bundled migration is "absent" from an empty ledger, and none of them
    // is missing from a prefix it does not have. Treating a fresh database as
    // gapped would route provisioning through the heal path; this is the same
    // guard `replayGateVerdict` makes on `count === 0` and it is the one most
    // likely to be dropped by someone tightening this later.
    expect(ledgerGapFor(ledger([]))).toBeNull()
  })

  it('is null on a ledger already at the tip', () => {
    expect(ledgerGapFor(ledger(ALL_WHEN))).toBeNull()
  })

  it('is null on a contiguous ledger behind the tip — the control', () => {
    const cutoff = BUNDLED_MIGRATIONS.findIndex((e) => e.tag.startsWith('0248_'))
    expect(ledgerGapFor(ledger(ALL_WHEN.slice(0, cutoff + 1)))).toBeNull()
  })

  it('is null for a workspace ahead of this build, whose extra rows are not holes', () => {
    // A workspace a newer image has already migrated past keeps being served (§10.2).
    // Its ledger carries a `when` this build has never heard of, and that must
    // not read as drift.
    expect(ledgerGapFor(ledger([...ALL_WHEN, latestBundledVersion() + 1_000]))).toBeNull()
  })

  it('finds a ledger hole, and does not mistake the forward tail for it', () => {
    const gap = ledgerGapFor(ledger(REPRESENTATIVE_DRIFT))
    expect(gap).not.toBeNull()
    // 0253 and later are ABOVE the high-water mark, so they are an ordinary
    // rollout tail rather than part of the hole. Only what is missing from the
    // prefix this ledger claims to have completed counts.
    expect(gap!.missing).toEqual(['0250_job_queue'])
    expect(gap!.from).toBe(whenOf('0250'))
    // The rows the truncation withdraws: applied, at or above the truncation
    // point, and bundled here so drizzle can write them back.
    expect(gap!.rewrites).toEqual([
      '0251_pg_kv_presence_realtime',
      '0252_conversation_spam_retention_idx',
    ])
    expect(gap!.unrewritable).toEqual([])
  })

  it('reports rows this build cannot rewrite, rather than silently discarding them', () => {
    const ahead = latestBundledVersion() + 1_000
    const gap = ledgerGapFor(ledger([...withoutRows('0249'), ahead]))
    expect(gap!.unrewritable).toEqual([ahead])
  })
})

describe('planFor', () => {
  it('reports the complete repair where the high-water mark reports only the tail', () => {
    // The whole defect in one assertion. `replaySetFor` answers a question about
    // drizzle's high-water mark; on this ledger that answer reads as "nearly
    // current" at the moment the database is least current.
    const applied = ledger(REPRESENTATIVE_DRIFT)
    const replay = replaySetFor(applied)
    const plan = planFor(applied).tags

    // Drizzle's answer is the tail above the mark, and nothing else.
    expect(replay).toEqual(tagsAbove(REPRESENTATIVE_MARK))
    // It contains none of the hole. That omission is the entire defect: the
    // rows the database is actually missing are the ones it will never revisit.
    for (const prefix of REPRESENTATIVE_HOLE) expect(replay).not.toContain(tagOf(prefix))

    // The plan spans from the earliest missing entry to the tip, so it covers
    // the hole as well as the tail, and is therefore strictly the larger set.
    expect(plan).toEqual(tagsFrom(whenOf(REPRESENTATIVE_HOLE[0]!)))
    for (const prefix of REPRESENTATIVE_HOLE) expect(plan).toContain(tagOf(prefix))
    expect(plan.length).toBeGreaterThan(replay.length)
  })

  it('is exactly replaySetFor whenever the ledger has no hole — the control', () => {
    // Unchanged behaviour is the property that matters most here: every ordinary
    // rollout, every fresh database and every already-current workspace has to be
    // routed exactly as it was before the heal existed.
    const cutoff = BUNDLED_MIGRATIONS.findIndex((e) => e.tag.startsWith('0248_'))
    for (const applied of [
      ledger([]),
      ledger(ALL_WHEN),
      ledger(ALL_WHEN.slice(0, cutoff + 1)),
      ledger([...ALL_WHEN, latestBundledVersion() + 1_000]),
    ]) {
      const plan = planFor(applied)
      expect(plan.gap).toBeNull()
      expect(plan.tags).toEqual(replaySetFor(applied))
    }
  })

  it('starts at the earliest missing entry, because everything below it is present', () => {
    // The equality the heal rests on: after deleting every row at or above
    // `from`, the new high-water mark is the largest applied value below `from`,
    // and every bundled entry below `from` is in the ledger — so what drizzle
    // then applies is precisely the bundled entries at or above `from`.
    const applied = ledger(REPRESENTATIVE_DRIFT)
    const { gap, tags } = planFor(applied)
    const below = BUNDLED_MIGRATIONS.filter((e) => e.when < gap!.from)
    expect(below.every((e) => applied.versions.has(e.when))).toBe(true)
    expect(tags).toEqual(BUNDLED_MIGRATIONS.filter((e) => e.when >= gap!.from).map((e) => e.tag))
  })
})

describe('gapHealVerdict', () => {
  const verdictFor = (versions: number[]) => {
    const applied = ledger(versions)
    const { gap, tags } = planFor(applied)
    return gapHealVerdict(gap!, verdictsFor(tags))
  }

  it('heals the representative hole — every migration it replays is a no-op', () => {
    expect(verdictFor(REPRESENTATIVE_DRIFT)).toEqual({ ok: true })
  })

  it('refuses when a row it would delete records a migration that is not a no-op', () => {
    // Truncating past 0246 puts 0247 back in the replay set, and 0247's row was
    // there — so it ran, and re-running it is not a risk, it is a certainty of
    // failure. Because nothing here inserts a ledger row, a truncation that then
    // cannot replay leaves the workspace further under-claimed with no run that can
    // ever succeed. That is why the refusal has to come before the DELETE.
    const verdict = verdictFor(withoutRows('0246'))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.detail).toContain('0247_user_tags')
    expect(verdict.detail).toContain('the deleted rows cannot be restored')
  })

  it('refuses when the hole itself contains a mutating migration, and names it', () => {
    // A ledger stopping short of 0006 and then jumping to 0012: the rows it
    // would rewrite (0012) are replay-safe, so the only thing standing in the
    // way is the hole's own content — which includes an INSERT with no ON
    // CONFLICT. Nothing in a ledger can say whether that ran; that is what a
    // hole means, and it is why a human has to look.
    const verdict = verdictFor([...ALL_WHEN.filter((v) => v < whenOf('0006')), whenOf('0012')])
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.detail).toContain('0006_thick_arclight')
    expect(verdict.detail).toContain('--allow-mutating-replay does not override')
  })

  it('refuses to discard rows this build cannot rewrite', () => {
    const ahead = latestBundledVersion() + 1_000
    const verdict = verdictFor([...withoutRows('0249'), ahead])
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.detail).toContain(String(ahead))
    expect(verdict.detail).toContain('This workspace is ahead of this image')
  })
})

describe('replayGateVerdict', () => {
  it('lets a fresh database through even though its replay set is full of writes', () => {
    // The whole lineage from 0000_initial. Refusing it would refuse every new
    // workspace, and there is nothing to apply twice on an empty ledger.
    const tags = replaySetFor(ledger([]))
    const verdicts = verdictsFor(tags)
    expect(verdicts.some((v) => v.verdict === 'mutates')).toBe(true)
    expect(replayGateVerdict(ledger([]), verdicts, false)).toEqual({ ok: true })
  })

  it('refuses a mutating replay against a database with an existing ledger', () => {
    const before = ledger([1, 2, 3])
    const verdicts = verdictsFor(['0006_thick_arclight'])
    const verdict = replayGateVerdict(before, verdicts, false)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.detail).toContain('0006_thick_arclight')
    // The refusal has to name the repair, not just the problem — this is the
    // message an operator reads mid-rollout.
    expect(verdict.detail).toContain('a wrong row is worse than a missing one')
  })

  it('allows the same set once the operator has established the ledger is honest', () => {
    const verdicts = verdictsFor(['0006_thick_arclight'])
    expect(replayGateVerdict(ledger([1, 2, 3]), verdicts, true)).toEqual({ ok: true })
  })

  it('lets an ordinary rollout through — errors-on-replay is not dangerous', () => {
    // The realistic case: a workspace at 0248 and a build shipping 0253. Most of
    // what lies between is plain DDL that would error on a second run, and
    // migrate()'s transaction bounds that. A gate that refused it would refuse
    // every rollout this system exists to perform.
    //
    // Bounded at 0256 rather than run to the tip: 0257 is a data migration, and
    // the point of THIS case is the DDL-only tail. The tail that does contain
    // it is the case below, which is where its consequence is recorded.
    const cutoff = BUNDLED_MIGRATIONS.findIndex((e) => e.tag.startsWith('0248_'))
    const end = BUNDLED_MIGRATIONS.findIndex((e) => e.tag.startsWith('0257_'))
    const before = ledger(BUNDLED_MIGRATIONS.slice(0, cutoff + 1).map((e) => e.when))
    const tags = replaySetFor(before).slice(0, end - cutoff - 1)
    const verdicts = verdictsFor(tags)
    expect(tags.length).toBeGreaterThan(0)
    expect(verdicts.every((v) => v.verdict !== 'mutates')).toBe(true)
    expect(replayGateVerdict(before, verdicts, false)).toEqual({ ok: true })
  })

  it('this phase’s post-0248 migration span no longer heals for free', () => {
    // The span is listed deliberately: a newly mutating migration must turn
    // this test red so the operator path is documented in the phase that
    // introduces it.
    //
    // **It has now happened, and this case is the notice.** 0257 demotes every
    // sending domain verified by a check that could not tell an owner from
    // anybody else (an UPDATE); 0262 drops a table and 0263 rewrites stored
    // product-flag defaults. All three are writes the gate will not replay
    // unattended. Healing a ledger gap across them is now an operator action:
    // establish that the ledger is honest — a branch dry-run is the cheap way —
    // and re-run with `allowMutatingReplay`.
    const cutoff = BUNDLED_MIGRATIONS.findIndex((e) => e.tag.startsWith('0248_'))
    const before = ledger(BUNDLED_MIGRATIONS.slice(0, cutoff + 1).map((e) => e.when))
    expect(replaySetFor(before)).toEqual([
      '0249_identity_provider_last_test_capture',
      '0250_job_queue',
      '0251_pg_kv_presence_realtime',
      '0252_conversation_spam_retention_idx',
      '0253_event_dispatch_owner',
      '0254_event_dispatch_owner_default_job',
      '0255_settings_cloud_tenant_id',
      '0256_workspace_key_columns',
      '0257_sending_domain_reverify',
      '0258_email_log',
      '0259_channel_threads',
      '0260_channel_threads_conversation_fk',
      '0261_connectors',
      '0262_drop_assistant_custom_actions',
      '0263_core_product_flag_defaults',
      '0264_settings_cloud',
      '0265_billing',
      '0266_settings_cloud_secret_canary',
      '0267_drop_workspace_billing',
      '0268_cloud_identity_projection',
      '0269_messenger_ai_default_on',
    ])
    const verdict = replayGateVerdict(before, verdictsFor(replaySetFor(before)), false)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.detail).toContain('0257_sending_domain_reverify')

    // And it goes through once an operator has said the ledger is honest, which
    // is the whole point of the flag rather than of a weaker gate.
    expect(replayGateVerdict(before, verdictsFor(replaySetFor(before)), true)).toEqual({
      ok: true,
    })
  })
})
