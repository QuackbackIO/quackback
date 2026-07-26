import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The migrator gates on the journal entry's `when`, NOT on the filename.
 * `drizzle.__drizzle_migrations` is read as a single high-water mark
 * (`ORDER BY created_at DESC LIMIT 1`) and any entry whose `when` exceeds it
 * runs; hashes are stored but never compared.
 *
 * So an entry carrying a `when` from before the current tip — the normal shape
 * of a rebased branch or an external contributor's PR — replays on a fresh
 * database and is SILENTLY SKIPPED on every already-upgraded one. That is not a
 * degraded feature: a missing column makes `listIdentityProviders()` throw, and
 * `createAuth()` calls it synchronously, so every auth request 500s on an
 * instance nobody is watching. This has already cost a skipped migration in
 * production in the sibling control-plane repo.
 *
 * Renaming a file to a higher number does NOT fix it. These are the invariants
 * that do.
 */

const DRIZZLE_DIR = join(import.meta.dirname, '../../drizzle')

type JournalEntry = { idx: number; when: number; tag: string }

const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta/_journal.json'), 'utf-8')) as {
  entries: JournalEntry[]
}

const sqlFiles = readdirSync(DRIZZLE_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

/**
 * Pre-existing violations, grandfathered so this guard protects against NEW
 * ones instead of being permanently red.
 *
 * `0052_otp_to_magic_link` carries when=1777655280134, roughly four hours
 * BEFORE 0050/0051 (…821603/…821604, evidently hand-assigned). It was authored
 * before them and numbered after them — the rebase artifact this whole test
 * exists to catch, already in the tree.
 *
 * Consequence: a fresh database applies everything (the high-water mark starts
 * at zero), but any instance sitting at 0051 when 0052 shipped skipped it
 * permanently, so its workspaces still hold `oauth.email = true` instead of
 * `oauth.magicLink = true`.
 *
 * It is NOT fixed here on purpose. The migration is a WHERE-guarded backfill
 * and therefore idempotent, so renumbering its `when` to the end would no-op
 * where it already ran and correctly apply where it was skipped — but that
 * re-runs a migration against every existing installation, which is a call to
 * make deliberately rather than as a side effect of adding a test.
 */
const KNOWN_HISTORICAL_WHEN_REGRESSIONS = new Set(['0052_otp_to_magic_link'])

/**
 * Adjacent entry pairs where `key` fails to strictly increase. Shared by every
 * ordering assertion so the pairing and the comparison exist once — three
 * copies of this would let a future fix land in one and silently reintroduce
 * the very bug class this file guards, in whichever copy was missed.
 */
function nonMonotonic(key: 'when' | 'idx'): { e: JournalEntry; prev: JournalEntry }[] {
  return journal.entries
    .slice(1)
    .map((e, i) => ({ e, prev: journal.entries[i]! }))
    .filter(({ e, prev }) => e[key] <= prev[key])
}

describe('migration journal integrity', () => {
  it('has at least one entry', () => {
    expect(journal.entries.length).toBeGreaterThan(0)
  })

  it('`when` strictly increases in entry order', () => {
    const offenders = nonMonotonic('when')
      .filter(({ e }) => !KNOWN_HISTORICAL_WHEN_REGRESSIONS.has(e.tag))
      .map(
        ({ e, prev }) => `${e.tag} (when=${e.when}) does not exceed ${prev.tag} (when=${prev.when})`
      )
    expect(offenders).toEqual([])
  })

  it('`idx` strictly increases in entry order', () => {
    const offenders = nonMonotonic('idx').map(
      ({ e, prev }) => `${e.tag} (idx=${e.idx}) does not exceed ${prev.tag}`
    )
    expect(offenders).toEqual([])
  })

  it('every allowlisted entry is still actually broken', () => {
    // Keeps the exception list honest: once an entry is renumbered, its
    // allowlist line must go rather than linger and mask the next break.
    const stillBroken = new Set(nonMonotonic('when').map(({ e }) => e.tag))
    for (const tag of KNOWN_HISTORICAL_WHEN_REGRESSIONS) {
      expect(stillBroken.has(tag)).toBe(true)
    }
  })

  it('every journal entry has a matching .sql file', () => {
    const missing = journal.entries
      .filter((e) => !sqlFiles.includes(`${e.tag}.sql`))
      .map((e) => `${e.tag}.sql is journalled but absent from drizzle/`)
    expect(missing).toEqual([])
  })

  it('every .sql file has exactly one journal entry', () => {
    const tagCounts = new Map<string, number>()
    for (const e of journal.entries) tagCounts.set(e.tag, (tagCounts.get(e.tag) ?? 0) + 1)

    const problems: string[] = []
    for (const file of sqlFiles) {
      const tag = file.replace(/\.sql$/, '')
      const count = tagCounts.get(tag) ?? 0
      if (count === 0) problems.push(`${file} exists but is not journalled, so it will never run`)
      if (count > 1) problems.push(`${file} has ${count} journal entries`)
    }
    expect(problems).toEqual([])
  })

  it('no two entries share a `when`', () => {
    const seen = new Map<number, string>()
    const collisions: string[] = []
    for (const e of journal.entries) {
      const prior = seen.get(e.when)
      if (prior) collisions.push(`${e.tag} collides with ${prior} on when=${e.when}`)
      seen.set(e.when, e.tag)
    }
    expect(collisions).toEqual([])
  })
})
